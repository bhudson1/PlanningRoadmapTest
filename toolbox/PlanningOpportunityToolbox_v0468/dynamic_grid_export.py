# -*- coding: utf-8 -*-
"""Planning Opportunity dynamic configurable grid export, ArcGIS Pro 3.1/ArcPy.

The web cells are a spatial INDEX. Scores use the established 10 m snap grid,
then are summarized in web cells of the selected size (default 100 m).
No weights are baked into exported factor scores.
"""
import os
import math
import json
import tempfile
import datetime
import collections
import re

EXPORTER_VERSION = '0.4.65'
DEFAULT_WEB_CELL_M = 100
SOURCE_CELL_M = 10


def validate_grid_cell_m(cell_m):
    """Validate requested web-grid resolution before expensive ArcPy work."""
    try:
        size = float(cell_m)
    except (TypeError, ValueError):
        raise ValueError('Web grid cell size must be a whole number of metres.')
    if not math.isfinite(size) or int(size) != size:
        raise ValueError('Web grid cell size must be a whole number of metres.')
    cell = int(size)
    if not 10 <= cell <= 1000 or cell % SOURCE_CELL_M:
        raise ValueError('Web grid cell size must be a multiple of 10 metres between 10 and 1000.')
    return cell
NODATA = -9999.0


def _workbook_records(path, arcpy, gdb):
    import openpyxl
    out = []
    book = openpyxl.load_workbook(path, read_only=True, data_only=True)
    try:
        for stage in ('Baseline', 'Gap'):
            sheet_name = stage + ' Weightings'
            if sheet_name not in book.sheetnames:
                raise ValueError('Missing workbook sheet ' + sheet_name)
            for rownum, row in enumerate(book[sheet_name].iter_rows(min_row=2, values_only=True), 2):
                if not row or len(row) < 5 or not row[1] or not row[2]:
                    continue
                category, factor, raster_name = [str(row[i] or '').strip() for i in (0,1,2)]
                try: weight = float(row[4] or 0)
                except (ValueError,TypeError): raise ValueError('{} row {}: bad weight'.format(sheet_name,rownum))
                if weight < 0: raise ValueError('{} row {}: negative weight'.format(sheet_name,rownum))
                method = str(row[6] or '').strip() if len(row)>6 else ''
                if not method: method = 'Reweight available factors'
                if method not in ('Euclidean Allocation','Reweight available factors'):
                    raise ValueError('{} row {}: invalid NoData method {}'.format(sheet_name,rownum,method))
                # Include zero-weight factor rows so a browser slider can TURN THEM ON.
                # These rows are optional if their raster is absent; weighted rows are not.
                raspath=os.path.join(gdb,raster_name)
                if not arcpy.Exists(raspath) and not raster_name.endswith('Mix_GAP'):
                    if weight:
                        raise ValueError('Required {} factor raster is missing: {}'.format(stage,raspath))
                    arcpy.AddWarning('[Dynamic Grid] Skipping unavailable zero-weight factor: '+factor)
                    continue
                if stage=='Gap' and (category.lower().startswith('pipeline') or factor.lower().startswith('pipeline')):
                    if method=='Euclidean Allocation':
                        arcpy.AddWarning('[Dynamic Grid] Forcing no-fill for pipeline factor: '+factor)
                        method='Reweight available factors'
                out.append({'id':'F{:03d}'.format(len(out)+1),'stage':stage,
                            'spreadsheet_row':rownum,'default_weight':weight,
                            'category':category,'name':factor,'raster':raster_name,
                            'original_weight':weight,'nodata_method':method,
                            'score_scale':100 if stage=='Gap' and raster_name.endswith('Mix_GAP') else 1,
                            'movable': stage=='Baseline' and (category.lower()=='daily needs' or
                                category.lower()=='community spaces' or 'community centre' in factor.lower())})
    finally: book.close()
    if not any(x['stage']=='Baseline' for x in out) or not any(x['stage']=='Gap' for x in out):
        raise ValueError('Both Baseline and Gap need at least one available factor.')
    return out


def _factor_meta(excel, helper):
    config=helper._popup_value_config(excel)
    return config


def _config_housing(excel):
    import openpyxl
    book = openpyxl.load_workbook(excel, read_only=True, data_only=True)
    try:
        targets={}
        for row in book['Gap Mix Targets'].iter_rows(min_row=2,values_only=True):
            if row and row[0] in ('Existing Housing Types','Pipeline Housing Types') and row[1]:
                targets.setdefault(str(row[0]),{})[str(row[1])] = float(row[4])
        thresholds={}
        for row in book['Tenure Priorities'].iter_rows(min_row=4,max_row=6,values_only=True):
            if row and row[0] in ('Rental','BMR','NMH'):
                thresholds[row[0]]={'high':float(row[3])*100, 'combined':float(row[4])*100}
        direction=str(book['Tenure Priorities']['B24'].value or 'Gap (ownership high)')
        return dict(targets=targets,tenure_thresholds=thresholds,tenure_direction=direction)
    finally:book.close()


def _aggregate(arr, domain, cell_id, cell_count, minimum=None, maximum=None, categorical=False):
    """Domain-restricted mean (numeric) / mode (categorical) across 10m pixels."""
    import numpy as np
    values=np.asarray(arr,dtype=np.float64)
    valid = domain & np.isfinite(values) & (values != NODATA)
    if minimum is not None: valid &= values>=minimum
    if maximum is not None: valid &= values<=maximum
    ids=cell_id[valid]
    if not len(ids):return np.full(cell_count,np.nan,dtype=np.float64),np.zeros(cell_count,dtype=np.int32)
    counts=np.bincount(ids,minlength=cell_count).astype(np.int32)
    if categorical:
        vals=values[valid].astype(np.int64)
        answer=np.full(cell_count,np.nan,dtype=np.float64)
        wins=np.zeros(cell_count,dtype=np.int32)
        for value in np.unique(vals):
            sub=np.bincount(ids[vals==value],minlength=cell_count).astype(np.int32)
            replace=sub>wins
            answer[replace]=int(value)
            wins[replace]=sub[replace]
        return answer,counts
    sums=np.bincount(ids,weights=values[valid],minlength=cell_count)
    means=np.full(cell_count,np.nan,dtype=np.float64)
    np.divide(sums,counts,out=means,where=counts>0)
    return means,counts


def _safeval(value,decimals=3):
    import math
    return round(float(value),decimals) if math.isfinite(float(value)) else None


def _aggregate_stage_equal(records, columns, valid_cells, stage):
    import numpy as np
    sources=[r for r in records if r['stage']==stage]
    arrays=[columns[r['id']] for r in sources]
    numer=np.zeros(len(valid_cells),dtype=np.float64)
    denom=np.zeros(len(valid_cells),dtype=np.int32)
    for array in arrays:
        valid=np.isfinite(array)
        numer[valid]+=array[valid]
        denom[valid]+=1
    out=np.full(len(valid_cells),np.nan,dtype=np.float64)
    np.divide(numer,denom,out=out,where=denom>0)
    return out


def _grid_assignments(ref, shape, extent, domain, cell_m):
    """Map selected source pixel centres to a stable, UTM-anchored web grid.

    The snap raster normally has a rectangular extent that extends *outside*
    the irregular municipal study boundary.  These out-of-study pixels MUST
    NOT cause a failure or enlarge the exported study area.  All aggregation
    calls mask them out using ``domain`` before accessing the grid IDs.
    """
    import numpy as np
    mask=np.asarray(domain,dtype=bool)
    if mask.shape!=shape:
        raise ValueError('Study mask and reference raster dimensions differ.')
    selected_rows=np.any(mask,axis=1)
    selected_cols=np.any(mask,axis=0)
    if not np.any(selected_rows) or not np.any(selected_cols):
        raise ValueError('The selected study area contains no eligible 10 m cells.')

    xcenters=(float(ref.extent.XMin) +
              (np.arange(shape[1],dtype=np.float64)+0.5)*float(ref.meanCellWidth))
    ycenters=(float(ref.extent.YMax) -
              (np.arange(shape[0],dtype=np.float64)+0.5)*float(ref.meanCellHeight))
    xgrid=np.floor(xcenters/cell_m).astype(np.int64)
    ygrid=np.floor(ycenters/cell_m).astype(np.int64)

    # Start with the projected polygon's bounding box.  Include any eligible
    # 10 m cell centre at the boundary, guarding against floating-point extent
    # rounding without incorporating unrelated snap-raster coverage.
    left=min(int(math.floor(extent.XMin/cell_m)),int(np.min(xgrid[selected_cols])))
    bottom=min(int(math.floor(extent.YMin/cell_m)),int(np.min(ygrid[selected_rows])))
    right=max(int(math.ceil(extent.XMax/cell_m)),int(np.max(xgrid[selected_cols]))+1)
    top=max(int(math.ceil(extent.YMax/cell_m)),int(np.max(ygrid[selected_rows]))+1)
    ncols=right-left
    nrows=top-bottom
    if ncols<=0 or nrows<=0:
        raise ValueError('Invalid projected web study grid dimensions.')

    xi=xgrid-left
    yi=ygrid-bottom
    valid_cols=(xi>=0)&(xi<ncols)
    valid_rows=(yi>=0)&(yi<nrows)
    if np.any(selected_cols & ~valid_cols) or np.any(selected_rows & ~valid_rows):
        raise ValueError('A study-area source pixel could not be assigned to a web grid cell.')

    # Outside-study pixel centres can fall beyond the fishnet.  Give them a
    # harmless in-range placeholder ID (0); the caller's study mask excludes
    # these positions from ALL means and coverage counts.
    xi=np.clip(xi,0,ncols-1)
    yi=np.clip(yi,0,nrows-1)
    ids=yi[:,None]*ncols+xi[None,:]
    return ids, left,bottom,ncols,nrows


def _make_grid(arcpy, gdb, prefix, boundary, left,bottom,ncols,nrows,cell_m):
    """Physical configurable polygon cells clipped to exact study area."""
    grid_name=prefix+'_DynamicGrid{}m'.format(cell_m)
    result=os.path.join(gdb,grid_name)
    temp=os.path.join('in_memory','PO_dynamic_fishnet')
    if arcpy.Exists(temp):arcpy.management.Delete(temp)
    x0=left*cell_m; y0=bottom*cell_m
    x1=(left+ncols)*cell_m;y1=(bottom+nrows)*cell_m
    arcpy.management.CreateFishnet(temp,'{} {}'.format(x0,y0),
        '{} {}'.format(x0,y0+cell_m),cell_m,cell_m,0,0,'{} {}'.format(x1,y1),
        'NO_LABELS','', 'POLYGON')
    if int(getattr(arcpy.Describe(temp).spatialReference,'factoryCode',0) or 0)!=26910:
        arcpy.management.DefineProjection(temp,arcpy.SpatialReference(26910))
    arcpy.management.AddField(temp,'GRID_ID','TEXT',field_length=35)
    arcpy.management.AddField(temp,'GX','LONG')
    arcpy.management.AddField(temp,'GY','LONG')
    with arcpy.da.UpdateCursor(temp,['SHAPE@XY','GRID_ID','GX','GY']) as cur:
        for row in cur:
            gx=int(math.floor(row[0][0]/cell_m));gy=int(math.floor(row[0][1]/cell_m))
            row[1]='{}:{}'.format(gx,gy);row[2]=gx;row[3]=gy;cur.updateRow(row)
    if arcpy.Exists(result):
        arcpy.management.Delete(result)
    # Using PairwiseClip avoids exporting parts of cells beyond municipal limits.
    arcpy.analysis.PairwiseClip(temp,boundary,result)
    arcpy.management.Delete(temp)
    arcpy.management.AddIndex(result,'GRID_ID','IDX_GRID_ID')
    return result




def _reference_specs_validated(arcpy, reference_specs):
    """Validate optional ArcGIS feature layers before performing the raster work."""
    outputs=[]
    used_slugs=set()
    swatches=['#375a7f','#bf7045','#579b7e','#775a96','#b39440','#447f95']
    for index,spec in enumerate(reference_specs or []):
        source,label,name,color=(list(spec)+['','','',''])[:4]
        if source is None or not str(source).strip():
            continue
        if not arcpy.Exists(source):
            raise ValueError('Reference layer {} was not found: {}'.format(index+1,source))
        desc=arcpy.Describe(source)
        geom=str(getattr(desc,'shapeType','')).lower()
        if geom not in ('point','multipoint','polyline','polygon'):
            raise ValueError('Reference {} is not a feature layer with point, line or polygon geometry.'.format(source))
        label=str(label or '').strip()
        fields={f.name.lower():f.name for f in arcpy.ListFields(source)}
        if label and label.lower() not in fields:
            raise ValueError('Reference layer {} has no label field {}.'.format(source,label))
        label=fields[label.lower()] if label else ''
        friendly=str(name or getattr(desc,'name','') or 'Reference {}'.format(index+1)).strip()
        if not friendly:friendly='Reference {}'.format(index+1)
        if len(friendly)>150:raise ValueError('Reference display name exceeds 150 characters.')
        raw_color=str(color or '').strip()
        if raw_color and not re.fullmatch(r'#[0-9A-Fa-f]{6}',raw_color):
            raise ValueError('Use a hex colour like #4477AA for reference {}.'.format(friendly))
        color=raw_color or swatches[index%len(swatches)]
        slug=re.sub(r'[^a-z0-9]+','_',friendly.lower()).strip('_')[:50] or 'layer'
        suffix=slug
        j=2
        while suffix in used_slugs:
            suffix='{}_{}'.format(slug,j);j+=1
        used_slugs.add(suffix)
        outputs.append({'source':source,'field':label,'name':friendly,'color':color,
                        'id':suffix,'geometry_type':geom})
    return outputs


def _export_reference_layers(arcpy, reference_specs, boundary, web_folder):
    """Export only user-chosen label attributes, not all confidential source fields."""
    output_dir=os.path.join(web_folder,'data','references')
    os.makedirs(output_dir,exist_ok=True)
    result=[]
    for i,spec in enumerate(reference_specs):
        tmp_lyr='PO_ReferenceSubset_{}'.format(i)
        tmp_fc=os.path.join('in_memory','PO_WebReference_{}'.format(i))
        output_name=spec['id']+'.geojson'
        output_path=os.path.join(output_dir,output_name)
        try:
            if arcpy.Exists(tmp_lyr):arcpy.management.Delete(tmp_lyr)
            if arcpy.Exists(tmp_fc):arcpy.management.Delete(tmp_fc)
            arcpy.management.MakeFeatureLayer(spec['source'],tmp_lyr)
            # SUBSET_SELECTION respects a selection made in the ArcGIS Pro map.
            # If the input layer has a selection, retain it; otherwise select
            # from all intersecting features (SUBSET on empty returns zero).
            existing=str(getattr(arcpy.Describe(spec['source']),'FIDSet','') or '').strip()
            selection_mode='SUBSET_SELECTION' if existing else 'NEW_SELECTION'
            arcpy.management.SelectLayerByLocation(tmp_lyr,'INTERSECT',boundary,
                                                   selection_type=selection_mode)
            count=int(arcpy.management.GetCount(tmp_lyr)[0])
            if count==0:
                arcpy.AddWarning('[Dynamic Grid] No features intersect the study area: '+spec['name'])
                continue
            if count>100000:
                raise ValueError('Reference layer {} has {:,} features; filter or simplify it before web export.'.format(spec['name'],count))
            arcpy.management.CopyFeatures(tmp_lyr,tmp_fc)
            # Use a fixed WEB_LABEL field so layer label source fields can be renamed
            # later without accidentally publishing other GIS attributes.
            arcpy.management.AddField(tmp_fc,'WEB_LABEL','TEXT',field_length=255)
            if spec['field']:
                with arcpy.da.UpdateCursor(tmp_fc,[spec['field'],'WEB_LABEL']) as rows:
                    for row in rows:
                        row[1]=str(row[0])[:255] if row[0] is not None else ''
                        rows.updateRow(row)
            arcpy.management.DeleteField(tmp_fc,['WEB_LABEL'],'KEEP_FIELDS')
            arcpy.conversion.FeaturesToJSON(tmp_fc,output_path,'NOT_FORMATTED','NO_Z_VALUES',
                'NO_M_VALUES','GEOJSON','WGS84','USE_FIELD_NAME')
            result.append({'id':spec['id'],'name':spec['name'],'color':spec['color'],
                           'geometry_type':spec['geometry_type'],'label_field':'WEB_LABEL',
                           'source_label_field':spec['field'] or None,'file':'references/'+output_name,
                           'feature_count':count,'visible':True,'labels_visible':bool(spec['field'])})
            arcpy.AddMessage('[Dynamic Grid] Reference: {} ({:,} features) → {}'.format(spec['name'],count,output_name))
        finally:
            for temp in (tmp_lyr,tmp_fc):
                try:
                    if arcpy.Exists(temp):arcpy.management.Delete(temp)
                except Exception:pass
    return result




def update_references_only(arcpy, boundary, out_folder, reference_specs):
    """Fast publishing pass: reuse existing scores, refresh reference overlays."""
    meta_path=os.path.join(out_folder,'data','meta.json')
    grid_path=os.path.join(out_folder,'data','grid.geojson')
    if not os.path.isfile(meta_path) or not os.path.isfile(grid_path):
        raise ValueError('Reference-only mode requires an existing grid.geojson and meta.json in web app data/. Run the full export first.')
    with open(meta_path,encoding='utf-8') as f:metadata=json.load(f)
    specs=_reference_specs_validated(arcpy,reference_specs)
    prior=arcpy.env.overwriteOutput
    try:
        arcpy.env.overwriteOutput=True
        metadata['references']=_export_reference_layers(arcpy,specs,boundary,out_folder)
        # Atomic metadata update; the fixed scoring grid remains byte-for-byte unchanged.
        tmp=meta_path+'.tmp'
        with open(tmp,'w',encoding='utf-8') as f:json.dump(metadata,f,ensure_ascii=False,indent=2)
        os.replace(tmp,meta_path)
        arcpy.AddMessage('[Dynamic Grid] Updated {} reference overlays; grid.geojson unchanged.'.format(len(metadata['references'])))
        return metadata
    finally:
        arcpy.env.overwriteOutput=prior


def run_export(arcpy, helper, study_value, study_text, gdb, excel, prefix, out_folder, reference_specs=None, grid_cell_m=100):
    import numpy as np
    from scipy.ndimage import distance_transform_edt
    grid_cell_m=validate_grid_cell_m(grid_cell_m)
    reference_specs=_reference_specs_validated(arcpy,reference_specs)
    if not arcpy.Exists(gdb):raise ValueError('Output geodatabase does not exist: '+str(gdb))
    if not os.path.isfile(excel):raise ValueError('Configuration workbook not found: '+str(excel))
    if not os.path.isdir(out_folder):os.makedirs(out_folder)
    os.makedirs(os.path.join(out_folder,'data'),exist_ok=True)
    records=_workbook_records(excel,arcpy,gdb)
    report={'warnings':[],'factors':len(records)}
    old={name:getattr(arcpy.env,name) for name in ('overwriteOutput','outputCoordinateSystem','snapRaster','cellSize','mask','extent','addOutputsToMap')}
    tmp_boundary=None
    arcpy.CheckOutExtension('Spatial')
    try:
        tmp_boundary=helper._prepare_study_boundary(study_value,study_text,gdb)
        arcpy.env.overwriteOutput=True
        arcpy.env.outputCoordinateSystem=arcpy.SpatialReference(26910)
        arcpy.env.mask=None; arcpy.env.extent=None; arcpy.env.addOutputsToMap=False
        preferred=[dict(raster_name=r['raster']) for r in records if arcpy.Exists(os.path.join(gdb,r['raster']))]
        snap=helper._ensure_polygon_snap_grid(gdb,prefix,preferred)
        arcpy.env.snapRaster=snap;arcpy.env.cellSize=snap
        # Composite 1-5 scores are a function of raw proportions + the LIVE workbook
        # target/thresholds. Rebuild them so they are not stale from a prior run.
        arcpy.AddMessage('[Dynamic Grid] Refreshing four Gap housing mix composites from raw share rasters...')
        helper._prepare_gap_mix_composites(gdb,excel,snap,tmp_boundary)
        ref=arcpy.Raster(snap)
        if abs(float(ref.meanCellWidth)-SOURCE_CELL_M)>0.001 or abs(float(ref.meanCellHeight)-SOURCE_CELL_M)>0.001:
            raise ValueError('Expected the existing {} m analysis snap grid, found {}m.'.format(SOURCE_CELL_M,ref.meanCellWidth))
        domain=helper._study_area_domain_on_grid(gdb,snap,tmp_boundary)
        shape=(int(ref.height),int(ref.width))
        if domain.shape!=shape:raise ValueError('Boundary/analysis grid dimensions differ.')
        ext=arcpy.Describe(tmp_boundary).extent
        ids,left,bottom,ncols,nrows=_grid_assignments(ref,shape,ext,domain,grid_cell_m)
        cell_count=ncols*nrows
        arcpy.AddMessage('[Dynamic Grid] Indexed {:,} study-area {} m pixels '
                         'into a {} x {} grid of {} m cells. Extra snap-raster '
                         'pixels outside the city are ignored.'.format(
                             int(np.count_nonzero(domain)),SOURCE_CELL_M,ncols,nrows,grid_cell_m))
        if ncols*nrows > 75000:
            arcpy.AddWarning('[Dynamic Grid] Selected {} m cells create {:,} candidate cells. '
                'Exports may be very large and slow to load; consider 100 m or 200 m.'.format(
                    grid_cell_m,ncols*nrows))
        # Dense IDs are temporary and only used to summarize valid 10m pixels.
        cell_ids=np.asarray(ids,dtype=np.int64)
        area,area_n=_aggregate(np.ones(shape,dtype=np.float32),domain,cell_ids,cell_count,0,2)
        valid_cells=area_n>0
        factor_values={};coverage={};native_values={}
        config=_factor_meta(excel,helper)
        lookup=helper._popup_lookup_read(gdb)
        for idx,rec in enumerate(records,1):
            path=os.path.join(gdb,rec['raster'])
            if not arcpy.Exists(path):raise ValueError('Missing Gap mix raster after refresh: '+path)
            arcpy.AddMessage('[Dynamic Grid] {}/{} {}'.format(idx,len(records),rec['name']))
            pixels=helper._factor_array_with_nodata_method(path,snap,rec['nodata_method'],rec['score_scale'])
            scores=np.asarray(pixels,dtype=np.float32)/float(rec['score_scale'])
            vals,count=_aggregate(scores,domain,cell_ids,cell_count,0.0001,5.0001)
            factor_values[rec['id']]=vals
            coverage[rec['id']]=count
            cmeta=config.get(rec['name'],{})
            rec['description']=cmeta.get('description') or ''
            rec['citation']=cmeta.get('citation') or ''
            rec['source_field']=cmeta.get('source_field') or ''
            rec['original_value_template']=cmeta.get('template') or ''
            if rec['stage']=='Baseline':
                native_name=helper._popup_value_name(cmeta.get('output_name') or rec['raster'])
                source_path=os.path.join(gdb,native_name)
                if arcpy.Exists(source_path):
                    raw=np.asarray(helper._native_array_on_reference(source_path,snap,nodata_value=NODATA),dtype=np.float32)
                    is_cat=bool(lookup.get(native_name))
                    agg,_=_aggregate(raw,domain,cell_ids,cell_count,-1.e12,1.e12,categorical=is_cat)
                    native_values[rec['id']]=agg
                    rec['native_field']='V'+rec['id'][1:]
                    rec['native_codes']=lookup.get(native_name,{}) if is_cat else None
                    rec['native_stat']='mode' if is_cat else 'mean'
            del pixels,scores
        # Preserve all 12 constituent raw housing shares in 0..1 units for context.
        shares={}
        specs=helper._gap_raw_share_specs(excel)
        share_arrays={}
        for spec in specs:
            path=os.path.join(gdb,spec['output'])
            if not arcpy.Exists(path):
                report['warnings'].append('Missing raw share '+spec['factor'])
                continue
            raw=np.asarray(helper._native_array_on_reference(path,snap,nodata_value=NODATA),dtype=np.float32)
            share_arrays[spec['factor']]=raw
        # Existing shares: nearest VALID COMPLETE trio (as in v0.4.53 polygon popups).
        names=dict(helper._gap_component_fields())
        for codes in [('EX_LOW','EX_MID','EX_HIGH'),('EX_RENT','EX_BMR','EX_NMH')]:
            factor_names=[next((name for name,code in names.items() if code==c),None) for c in codes]
            if all(x in share_arrays for x in factor_names):
                stack=[share_arrays[name] for name in factor_names]
                good=np.logical_and.reduce([np.isfinite(a)&(a>=0)&(a<=1.0001) for a in stack])
                if np.any(good) and np.any(~good):
                    near=distance_transform_edt(~good,return_distances=False,return_indices=True)
                    for name in factor_names:share_arrays[name]=share_arrays[name][tuple(near)]
        for factor,code in helper._gap_component_fields():
            raw=share_arrays.get(factor)
            if raw is None:continue
            vals,count=_aggregate(raw,domain,cell_ids,0+cell_count,0,1.0001)
            field='R_'+code
            shares[field]=vals
        additional={}
        for name,field in [('PO_PipelineUnits','PIPE_DWELLINGS'),('PO_PipelineProjects','PIPE_PROJECTS')]:
            path=os.path.join(gdb,name)
            if arcpy.Exists(path):
                raw=np.asarray(helper._native_array_on_reference(path,snap,nodata_value=NODATA),dtype=np.float64)
                vals,_=_aggregate(raw,domain,cell_ids,cell_count,0,1.e7)
                additional[field]=vals
        base=_aggregate_stage_equal(records,factor_values,valid_cells,'Baseline')
        gap=_aggregate_stage_equal(records,factor_values,valid_cells,'Gap')
        polygons=_make_grid(arcpy,gdb,prefix,tmp_boundary,left,bottom,ncols,nrows,grid_cell_m)
        for rec in records:
            arcpy.management.AddField(polygons,rec['id'],'DOUBLE',field_alias=rec['name'])
            arcpy.management.AddField(polygons,'C'+rec['id'][1:],'SHORT',field_alias=rec['name']+' coverage %')
            if rec['id'] in native_values:
                arcpy.management.AddField(polygons,'V'+rec['id'][1:],'DOUBLE',field_alias=rec['name']+' original value')
        for fld in list(shares)+list(additional):
            arcpy.management.AddField(polygons,fld,'DOUBLE')
        for fld in ['BASE_EQUAL','GAP_EQUAL','COMB_EQUAL']:
            arcpy.management.AddField(polygons,fld,'DOUBLE')
        all_fields=['GRID_ID','GX','GY']+[r['id'] for r in records]+['C'+r['id'][1:] for r in records]+[
            'V'+r['id'][1:] for r in records if r['id'] in native_values]+list(shares)+list(additional)+[
                'BASE_EQUAL','GAP_EQUAL','COMB_EQUAL']
        written=0
        with arcpy.da.UpdateCursor(polygons,all_fields) as cur:
            for row in cur:
                gx,gy=int(row[1]),int(row[2]);i=(gy-bottom)*ncols+(gx-left)
                if i<0 or i>=cell_count or not valid_cells[i]:
                    cur.deleteRow();continue
                values={'GRID_ID':'{}:{}'.format(gx,gy),'GX':gx,'GY':gy}
                for rec in records:
                    fid=rec['id'];values[fid]=_safeval(factor_values[fid][i]);
                    values['C'+fid[1:]]=int(round(100*coverage[fid][i]/float(area_n[i])))
                    if fid in native_values:values['V'+fid[1:]]=_safeval(native_values[fid][i])
                for field,array in list(shares.items())+list(additional.items()):
                    values[field]=_safeval(array[i],4)
                values['BASE_EQUAL']=_safeval(base[i]); values['GAP_EQUAL']=_safeval(gap[i]);
                values['COMB_EQUAL']=_safeval((base[i]+gap[i])/2) if np.isfinite(base[i]) and np.isfinite(gap[i]) else None
                for j,key in enumerate(all_fields):row[j]=values.get(key)
                cur.updateRow(row);written+=1
        if not written:raise ValueError('No cells remain inside the study boundary.')
        # Strip ArcGIS-generated OID metadata automatically via FeaturesToJSON.
        geojson=os.path.join(out_folder,'data','grid.geojson')
        arcpy.conversion.FeaturesToJSON(polygons,geojson,'NOT_FORMATTED','NO_Z_VALUES',
            'NO_M_VALUES','GEOJSON','WGS84','USE_FIELD_NAME')
        weights={stage:sum(r['original_weight'] for r in records if r['stage']==stage)
                 for stage in ('Baseline','Gap')}
        for stage,total in weights.items():
            if abs(total-100)>1e-6:
                arcpy.AddWarning('[Dynamic Grid] {} workbook weights total {}, not 100; web app will display a warning.'.format(stage,total))
        for rec in records:
            total=weights[rec['stage']]
            rec['original_weight_pct']=round(100*rec['original_weight']/total,3) if total>0 else 0
            rec.pop('original_weight',None)
        meta={'version':'1.0','created_utc':datetime.datetime.utcnow().isoformat()+'Z',
              'study':'City study-area polygon supplied in ArcGIS Pro',
              'grid_size_m':grid_cell_m,'source_cell_size_m':SOURCE_CELL_M,'spatial_ref':'EPSG:26910',
              'units':'Housing proportions R_* are fractions 0–1; scores are 1–5',
              'cell_count':written,'factors':records,'housing':_config_housing(excel),
              'report':report,
              'semantics':{'Baseline':'5 = stronger current conditions for accommodating growth',
                   'Gap':'5 = greater housing mix need / tenure priority',
                   'Move':'Moved accessible amenities use (6 - baseline score) to model amenity need',
                   'coverage':'Each score is the mean of valid scored {}m pixels in its {}m cell; no coverage means excluded from denominator'.format(SOURCE_CELL_M,grid_cell_m),
                   'shares':'Raw housing shares averaged across valid {}m pixels; tenure shares overlap'.format(SOURCE_CELL_M),
                   'units':'PIPE_DWELLINGS represents a source dissemination-area value observed at data collection, not new units located inside the web cell',
                   'scores':'Equal stage scores are mean of available per-factor cell scores, independent of workbook weights.'}}
        meta['references']=_export_reference_layers(arcpy,reference_specs,tmp_boundary,out_folder)
        with open(os.path.join(out_folder,'data','meta.json'),'w',encoding='utf-8') as f:
            json.dump(meta,f,ensure_ascii=False,indent=2)
        arcpy.AddMessage('[Dynamic Grid] Created {:,} polygons at {} m resolution: {}'.format(written,grid_cell_m,polygons))
        arcpy.AddMessage('[Dynamic Grid] Ready for GitHub Pages: {}'.format(os.path.join(out_folder,'data','grid.geojson')))
        arcpy.AddMessage('[Dynamic Grid] No factors are permanently weighted. Browser sliders calculate all scores.')
        return polygons,geojson,meta
    finally:
        if tmp_boundary is not None and arcpy.Exists(tmp_boundary):
            try:arcpy.management.Delete(tmp_boundary)
            except Exception:pass
        for name,value in old.items():
            try:setattr(arcpy.env,name,value)
            except Exception:pass
        arcpy.CheckInExtension('Spatial')
