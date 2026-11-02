/* Public City of Vancouver Open Data reference layers (Opendatasoft Explore API v2.1).
 * Static hosting; no API keys, OAuth, stored tokens, or login; overlay-only.
 * Uses paginated, map-bounded records instead of downloading entire datasets.
 */
const API='https://opendata.vancouver.ca/api/explore/v2.1/catalog/datasets';
const PUBLIC_CATALOG='https://opendata.vancouver.ca/explore/dataset/';
const MAX_FEATURES=2000;
const PAGE_SIZE=100;
const el=id=>document.getElementById(id);
const added=[];
let catalog=null, catalogPromise=null, getMap, getMapLoaded, getLabelAnchor;
let sequence=0;

function node(tag,cls,label){const e=document.createElement(tag);if(cls)e.className=cls;if(label!==undefined)e.textContent=label;return e;}
function status(message,type='info'){
 const p=el('openDataStatus');if(!p)return;
 p.textContent=message;p.dataset.type=type;
}
function safeDatasetId(id){
 if(!/^[a-z0-9][a-z0-9_-]{1,130}$/i.test(String(id)))throw Error('Enter a valid Vancouver dataset ID.');
 return String(id);
}
async function jsonFetch(url){
 const response=await fetch(url,{mode:'cors',headers:{Accept:'application/json'}});
 if(!response.ok){let details='';try{const j=await response.json();details=j.message||j.error||'';}catch(_){}
  throw Error('Open Data API HTTP '+response.status+(details?' · '+details:''));}
 return response.json();
}
function spatialField(dataset){return (dataset.fields||[]).find(f=>f.type==='geo_shape') || (dataset.fields||[]).find(f=>f.type==='geo_point_2d');}
function title(dataset){return dataset.metas?.default?.title||dataset.dataset_id;}
function arrayValues(v){return Array.isArray(v)?v:(typeof v==='string'?[v]:[]);}
function fieldSummary(dataset){return arrayValues(dataset.metas?.default?.theme).join(', ')||arrayValues(dataset.metas?.default?.keyword).slice(0,2).join(', ')||'Spatial data';}
function spatialDataset(dataset){return !!spatialField(dataset)&&dataset.data_visible!==false&&dataset.has_records!==false;}
async function getCatalog(){
 if(catalog)return catalog;
 if(catalogPromise)return catalogPromise;
 catalogPromise=(async()=>{
  let offset=0,total=Infinity,all=[];
  while(offset<total&&offset<1000){
   const params=new URLSearchParams({limit:'100',offset:String(offset)});
   const data=await jsonFetch(API+'?'+params);
   if(!Array.isArray(data.results))throw Error('Unexpected catalogue response.');
   all.push(...data.results);total=Math.max(0,Number(data.total_count)||all.length);
   offset+=data.results.length;
   if(!data.results.length)break;
  }
  catalog=all.filter(spatialDataset);
  return catalog;
 })().catch(e=>{catalogPromise=null;throw e;});
 return catalogPromise;
}
function resultCountLabel(d){const count=d.metas?.default?.records_count;return Number.isFinite(Number(count))?Number(count).toLocaleString()+' records':'Map layer';}
function renderSearch(list,term){
 const root=el('openDataResults');root.replaceChildren();
 const query=term.trim().toLowerCase();
 const matches=list.filter(d=>{
  if(!query)return true;
  const m=d.metas?.default||{};
  const hay=[d.dataset_id,m.title,...arrayValues(m.keyword),...arrayValues(m.theme)].join(' ').toLowerCase();
  return query.split(/\s+/).every(t=>hay.includes(t));
 }).sort((a,b)=>title(a).localeCompare(title(b)));
 el('openDataCount').textContent=`${matches.length} matching map datasets`;
 if(!matches.length){root.append(node('p','micro','No spatial datasets match that search. Try “parks”, “schools”, or a dataset ID.'));return;}
 for(const dataset of matches.slice(0,40)){
  const row=node('div','portal-item'),info=node('div');
  info.append(node('strong','',title(dataset)),node('small','',`${fieldSummary(dataset)} · ${resultCountLabel(dataset)}`));
  const btn=node('button','', 'Add');btn.type='button';
  btn.setAttribute('aria-label','Add '+title(dataset)+' to map');
  btn.addEventListener('click',async()=>{
   btn.disabled=true;btn.textContent='Loading…';
   try{await addDataset(dataset);}catch(e){status('Could not add '+title(dataset)+': '+e.message,'error');}
   finally{btn.disabled=false;btn.textContent='Add';}
  });
  row.append(info,btn);root.append(row);
 }
 if(matches.length>40)root.append(node('p','micro',`Showing first 40 of ${matches.length}. Refine the search to narrow the list.`));
}
async function search(){
 const q=el('openDataSearchText').value;
 const results=el('openDataResults');
 results.replaceChildren(node('p','micro','Loading Vancouver’s public spatial-data catalogue…'));
 status('Checking public datasets…');
 try{const list=await getCatalog();renderSearch(list,q);status(`Catalogue ready · ${list.length} public spatial datasets. No sign-in required.`,'success');}
 catch(e){results.replaceChildren(node('p','micro','Could not connect to the City of Vancouver Open Data API. Check network access or browser restrictions.'));
  status('Catalogue unavailable: '+e.message,'error');}
}
function validPoint(value){return Array.isArray(value)&&value.length>=2&&value.slice(0,2).every(Number.isFinite)&&Math.abs(value[0])<=180&&Math.abs(value[1])<=90;}
function recordGeometry(row,field){
 const v=row?.[field.name];if(!v)return null;
 if(field.type==='geo_point_2d'){
  if(typeof v.lon==='number'&&typeof v.lat==='number')return {type:'Point',coordinates:[v.lon,v.lat]};
  if(Array.isArray(v)&&v.length>=2){const [a,b]=v;
   // Opendatasoft's legacy 2D-point arrays are latitude/longitude.
   const xy=(Math.abs(a)<=90&&Math.abs(b)>90)?[b,a]:[a,b];
   if(validPoint(xy))return {type:'Point',coordinates:xy};
  }
 }
 let g=v?.geometry||v;
 if(g?.type==='Feature')g=g.geometry;
 if(g?.type==='FeatureCollection')return null;
 if(!g||!['Point','MultiPoint','LineString','MultiLineString','Polygon','MultiPolygon','GeometryCollection'].includes(g.type))return null;
 return g;
}
function normalizeRecords(records,field){
 const features=[];
 for(const raw of records){
  const p=raw?.fields&&typeof raw.fields==='object'?raw.fields:raw;
  const geometry=recordGeometry(p,field);
  if(!geometry)continue;
  const properties={};
  // Limit popup/property payload and never pass embedded geometry to MapLibre properties.
  for(const [key,value] of Object.entries(p)){
   if(key===field.name||typeof value==='object'||key==='recordid')continue;
   if(value===null||['string','number','boolean'].includes(typeof value))properties[key]=value;
  }
  features.push({type:'Feature',geometry,properties});
 }
 return features;
}
function viewportFilter(map,field){
 const b=map.getBounds();
 // ODSQL arguments are latitude/longitude, not GeoJSON longitude/latitude.
 const fix=n=>Number(n).toFixed(6);
 const south=Math.max(-90,b.getSouth()),north=Math.min(90,b.getNorth());
 const west=Math.max(-180,b.getWest()),east=Math.min(180,b.getEast());
 if(south>=north||west>=east)throw Error('Please zoom the map to a smaller, valid area first.');
 return `in_bbox(${field.name}, ${fix(south)}, ${fix(west)}, ${fix(north)}, ${fix(east)})`;
}
async function fetchFeatures(dataset,field,onProgress){
 const map=getMap(),where=viewportFilter(map,field),id=safeDatasetId(dataset.dataset_id);
 const endpoint=API+'/'+id+'/records';
 const path=offset=>endpoint+'?'+new URLSearchParams({where,limit:String(PAGE_SIZE),offset:String(offset)});
 const first=await jsonFetch(path(0));
 if(!Array.isArray(first.results))throw Error('The records endpoint did not return records.');
 const total=Number(first.total_count)||0;
 const loaded=[...first.results];
 const count=Math.min(total,MAX_FEATURES);
 const starts=[];
 for(let offset=PAGE_SIZE;offset<count;offset+=PAGE_SIZE)starts.push(offset);
 // At most three in-flight pages, minimizing rate-limit pressure.
 for(let i=0;i<starts.length;i+=3){
  const batch=await Promise.all(starts.slice(i,i+3).map(offset=>jsonFetch(path(offset))));
  for(const page of batch)loaded.push(...(page.results||[]));
  if(onProgress)onProgress(loaded.length,count);
 }
 const fc={type:'FeatureCollection',features:normalizeRecords(loaded,field).slice(0,MAX_FEATURES)};
 return {fc,total,truncated:total>MAX_FEATURES,skipped:loaded.length-fc.features.length};
}
function geomTypes(fc){const types=new Set();for(const f of fc.features)types.add(f.geometry?.type);return types;}
function layerIds(entry){return [entry.id+'-fill',entry.id+'-outline',entry.id+'-line',entry.id+'-point'];}
function attachToMap(entry,fc){
 const map=getMap(),sid=entry.id;
 map.addSource(sid,{type:'geojson',data:fc});
 const anchor=getLabelAnchor()||undefined;
 // Use geometry filters so datasets with mixed types draw correctly.
 const specs=[
  {id:sid+'-fill',type:'fill',filter:['==',['geometry-type'],'Polygon'],paint:{'fill-color':'#34799c','fill-opacity':.17}},
  {id:sid+'-outline',type:'line',filter:['==',['geometry-type'],'Polygon'],paint:{'line-color':'#2c6884','line-width':1.1}},
  {id:sid+'-line',type:'line',filter:['==',['geometry-type'],'LineString'],paint:{'line-color':'#2674a5','line-width':2.6}},
  {id:sid+'-point',type:'circle',filter:['==',['geometry-type'],'Point'],paint:{'circle-color':'#187ca2','circle-radius':5,'circle-stroke-color':'#fff','circle-stroke-width':1.6}}
 ];
 try{for(const spec of specs)map.addLayer({...spec,source:sid},anchor);}
 catch(e){for(const lid of layerIds(entry))if(map.getLayer(lid))map.removeLayer(lid);if(map.getSource(sid))map.removeSource(sid);throw e;}
 for(const lid of layerIds(entry)){
  map.on('click',lid,event=>{
   const f=event.features?.[0];if(!f)return;
   // Use textContent to avoid HTML injection from external records.
   const pane=node('div','opendata-popup');pane.append(node('strong','',entry.name));
   const properties=Object.entries(f.properties||{}).filter(([,v])=>v!==null&&String(v).length<220).slice(0,6);
   for(const [key,v] of properties)pane.append(node('div','opendata-prop',`${key.replace(/_/g,' ')}: ${v}`));
   new maplibregl.Popup({closeButton:true,maxWidth:'290px'}).setLngLat(event.lngLat).setDOMContent(pane).addTo(map);
  });
 }
}
async function addDataset(dataset){
 if(!getMapLoaded())throw Error('The map is still loading.');
 const id=safeDatasetId(dataset.dataset_id);
 if(added.some(x=>x.dataset.dataset_id===id)){status('That dataset is already shown. Use Reload extent to refresh it.');return;}
 const field=spatialField(dataset);if(!field)throw Error('This dataset has no supported map geometry.');
 status(`Loading ${title(dataset)} for the current map extent…`);
 const fetched=await fetchFeatures(dataset,field,(done,total)=>status(`Loading ${title(dataset)}… ${done.toLocaleString()} of ${total.toLocaleString()} records`));
 if(!fetched.fc.features.length){status(`No usable map features found in this extent for ${title(dataset)}. Try zooming out and adding it again.`);return;}
 const entry={id:'vancouver-open-'+(++sequence),name:title(dataset),dataset,field,visible:true,
  count:fetched.fc.features.length,total:fetched.total,truncated:fetched.truncated};
 attachToMap(entry,fetched.fc);added.push(entry);renderAdded();
 const note=entry.truncated?` Showing first ${MAX_FEATURES.toLocaleString()} of ${entry.total.toLocaleString()} matching records; zoom in and reload to see a smaller area.`:'';
 status(`Added ${entry.name}: ${entry.count.toLocaleString()} features.${note}`,'success');
}
function remove(entry){
 const map=getMap();if(map){for(const id of layerIds(entry))if(map.getLayer(id))map.removeLayer(id);if(map.getSource(entry.id))map.removeSource(entry.id);}
 const index=added.indexOf(entry);if(index!==-1)added.splice(index,1);renderAdded();
}
async function reload(entry){
 if(!getMapLoaded())throw Error('Map is still loading.');
 status(`Reloading ${entry.name} for the current map extent…`);
 const fresh=await fetchFeatures(entry.dataset,entry.field,(count,total)=>status(`Reloading ${entry.name}… ${count} / ${total} records`));
 // Never clear the existing source if a request fails or returns no matches.
 if(!fresh.fc.features.length){status(`No features in the new extent for ${entry.name}; prior layer retained.`);return;}
 getMap().getSource(entry.id)?.setData(fresh.fc);
 entry.count=fresh.fc.features.length;entry.total=fresh.total;entry.truncated=fresh.truncated;
 renderAdded();status(`Updated ${entry.name}: ${entry.count.toLocaleString()} features${entry.truncated?' (partial—zoom in for more)':''}.`,'success');
}
function renderAdded(){
 const root=el('openDataAddedList');root.replaceChildren();
 if(!added.length)return;
 root.append(node('strong','',`Added open-data layers (${added.length})`));
 for(const entry of added){
  const row=node('div','portal-item'),info=node('div');
  info.append(node('strong','',entry.name),node('small','',`${entry.count.toLocaleString()} map features${entry.truncated?' · limited to current extent / first '+MAX_FEATURES.toLocaleString():''}`));
  const options=node('div','open-data-row-actions');
  const visible=node('label','portal-visibility'),check=node('input');check.type='checkbox';check.checked=entry.visible;
  check.setAttribute('aria-label','Show '+entry.name);
  check.addEventListener('change',()=>{entry.visible=check.checked;for(const lid of layerIds(entry))if(getMap().getLayer(lid))getMap().setLayoutProperty(lid,'visibility',check.checked?'visible':'none');});
  visible.append(check,node('span','', 'Show'));
  const refresh=node('button','', 'Reload extent');refresh.type='button';
  refresh.addEventListener('click',async()=>{refresh.disabled=true;try{await reload(entry);}catch(e){status(`Could not reload ${entry.name}: ${e.message}`,'error');}finally{refresh.disabled=false;}});
  const removeBtn=node('button','', 'Remove');removeBtn.type='button';removeBtn.addEventListener('click',()=>remove(entry));
  const source=node('a','open-data-source','Dataset ↗');source.href=PUBLIC_CATALOG+encodeURIComponent(entry.dataset.dataset_id)+'/';source.target='_blank';source.rel='noopener noreferrer';
  options.append(visible,refresh,removeBtn,source);row.append(info,options);root.append(row);
 }
}
export function initOpenDataWidget(dependencies){
 ({getMap,getMapLoaded,getLabelAnchor}=dependencies);
 el('openDataSearch').addEventListener('click',search);
 el('openDataSearchText').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();search();}});
 el('openDataPanel').addEventListener('toggle',()=>{if(el('openDataPanel').open&&!catalog)search();});
 status('Public Vancouver datasets · no sign-in or API key required.');
}
// Export small pure helpers to test dataset conversions with synthetic API responses.
export const testHelpers={spatialField,recordGeometry,normalizeRecords,viewportFilter,spatialDataset};
