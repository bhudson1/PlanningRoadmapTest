/* Area-weighted polygon summaries for Planning Opportunity Explorer.
   Geometry uses the GeoJSON lon/lat coordinates exported by ArcGIS; polygon
   clipping is delegated to polygon-clipping (MIT) and areas are measured in a
   local equirectangular tangent plane at the drawn area's mean latitude.
   Calculations describe the EXPORTED grid scores and scenario weights, not
   a new resampling of the underlying ArcGIS rasters. */
const METRES_PER_DEGREE = 111195.0802335329;
export const AREA_SCORE_KEYS = ['baseline','gap','combined'];
const cachedBounds = new WeakMap();
export function bboxOfGeometry(geometry){
  if(!geometry || !geometry.coordinates)return null;
  if(cachedBounds.has(geometry))return cachedBounds.get(geometry);
  const bounds=[Infinity,Infinity,-Infinity,-Infinity];
  function walk(x){if(!Array.isArray(x))return;
    if(x.length>=2 && typeof x[0]==='number' && typeof x[1]==='number'){
      if(Number.isFinite(x[0]) && Number.isFinite(x[1])){
        bounds[0]=Math.min(bounds[0],x[0]);bounds[1]=Math.min(bounds[1],x[1]);
        bounds[2]=Math.max(bounds[2],x[0]);bounds[3]=Math.max(bounds[3],x[1]);
      }
    }else for(const p of x)walk(p);
  }
  walk(geometry.coordinates);
  const result=bounds.every(Number.isFinite)?bounds:null;
  cachedBounds.set(geometry,result);
  return result;
}
export function boxesOverlap(a,b){
  return !!(a&&b && a[0]<b[2] && b[0]<a[2] && a[1]<b[3] && b[1]<a[3]);
}
function planarRingArea(ring){
  if(!ring || ring.length<3)return 0;
  // Offset to reduce floating-point cancellation from large longitudes.
  const x0=ring[0][0],y0=ring[0][1];let sum=0;
  for(let i=0;i<ring.length;i++){
    const a=ring[i],b=ring[(i+1)%ring.length];
    sum+=(a[0]-x0)*(b[1]-y0)-(b[0]-x0)*(a[1]-y0);
  }
  return Math.abs(sum)/2;
}
export function multiPolygonAreaM2(multiPolygons,atLatitude){
  const latitude=Math.max(-85,Math.min(85,Number(atLatitude)||0));
  const k=METRES_PER_DEGREE*METRES_PER_DEGREE*Math.cos(latitude*Math.PI/180);
  let squareDegrees=0;
  for(const polygon of multiPolygons||[]){
    if(!Array.isArray(polygon)||!polygon.length)continue;
    let a=planarRingArea(polygon[0]);
    for(const hole of polygon.slice(1))a-=planarRingArea(hole);
    squareDegrees+=Math.max(0,a);
  }
  return Math.max(0,squareDegrees*k);
}
export function geometryAsMultiPolygon(geometry){
  if(geometry?.type==='Polygon')return [geometry.coordinates];
  if(geometry?.type==='MultiPolygon')return geometry.coordinates;
  return [];
}
export function intersectionAreaM2(areaGeometry,cellGeometry,clipper,latitude){
  if(typeof clipper?.intersection!=='function')throw new Error('Polygon intersection library is unavailable. Check network access and reload.');
  if(!boxesOverlap(bboxOfGeometry(areaGeometry),bboxOfGeometry(cellGeometry)))return 0;
  const a=geometryAsMultiPolygon(areaGeometry),b=geometryAsMultiPolygon(cellGeometry);
  if(!a.length||!b.length)return 0;
  // polygon-clipping accepts Polygon or MultiPolygon; it respects holes and
  // split geometries from the ArcGIS study-area clipping step.
  const output=clipper.intersection(a,b);
  return multiPolygonAreaM2(output,latitude);
}
export function newAreaAccumulator(areaGeometry){
  const box=bboxOfGeometry(areaGeometry);
  return {geometry:areaGeometry,bbox:box,latitude:box?(box[1]+box[3])/2:49.25,
    overlapM2:0,touched:0,values:{baseline:0,gap:0,combined:0},
    scoredArea:{baseline:0,gap:0,combined:0},scoredCells:{baseline:0,gap:0,combined:0},
    defaultValues:{baseline:0,gap:0,combined:0},
    defaultScoredArea:{baseline:0,gap:0,combined:0}};
}
export function addCellToAccumulator(acc,feature,clipper){
  if(!acc?.bbox||!feature?.geometry||!boxesOverlap(acc.bbox,bboxOfGeometry(feature.geometry)))return;
  const area=intersectionAreaM2(acc.geometry,feature.geometry,clipper,acc.latitude);
  if(area<=1e-6)return;
  acc.touched++;acc.overlapM2+=area;
  for(const key of AREA_SCORE_KEYS){
    const value=feature.properties?.[{baseline:'__base',gap:'__gap',combined:'__combined'}[key]];
    if(value===null||value===undefined||!Number.isFinite(Number(value))||Number(value)<1||Number(value)>5)continue;
    acc.values[key]+=area*Number(value);acc.scoredArea[key]+=area;acc.scoredCells[key]++;
  }
  // Fixed workbook defaults are accumulated using the SAME intersection
  // area as the live scenario. Missing current and default values are tracked
  // independently so we never invent zero scores for NoData cells.
  const defaultKeys={baseline:'__defaultBase',gap:'__defaultGap',combined:'__defaultCombined'};
  for(const key of AREA_SCORE_KEYS){
    const value=feature.properties?.[defaultKeys[key]];
    if(value===null||value===undefined||!Number.isFinite(Number(value))||Number(value)<1||Number(value)>5)continue;
    acc.defaultValues[key]+=area*Number(value);
    acc.defaultScoredArea[key]+=area;
  }
}
export function finishAreaAccumulator(acc){
  const scores={},defaults={},deltas={},coverage={};
  for(const key of AREA_SCORE_KEYS){
    scores[key]=acc.scoredArea[key]>0?acc.values[key]/acc.scoredArea[key]:null;
    defaults[key]=acc.defaultScoredArea[key]>0?acc.defaultValues[key]/acc.defaultScoredArea[key]:null;
    deltas[key]=scores[key]===null||defaults[key]===null?null:scores[key]-defaults[key];
    coverage[key]=acc.overlapM2>0?100*acc.scoredArea[key]/acc.overlapM2:0;
  }
  return {scores,defaults,deltas,coverage,overlapM2:acc.overlapM2,touched:acc.touched,
    scoredCells:{...acc.scoredCells},scoredArea:{...acc.scoredArea}};
}
export function computeAreaScores(geometry,features,clipper){
  const acc=newAreaAccumulator(geometry);
  for(const feature of features)addCellToAccumulator(acc,feature,clipper);
  return finishAreaAccumulator(acc);
}
