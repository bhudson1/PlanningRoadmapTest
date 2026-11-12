import {BIVARIATE,SCORE_STOPS,currentStage,adjustedFactorScore,computeScores,prettyScore,ratioText,stageWeightTotals,summarize} from './model.mjs?v=0476';
import {newAreaAccumulator,addCellToAccumulator,finishAreaAccumulator,bboxOfGeometry,multiPolygonAreaM2,geometryAsMultiPolygon} from './area_analysis.mjs?v=0476';
import {rectangleRing,orthogonalCoordinate} from './map_tools.mjs?v=0476';
const $=(id)=>document.getElementById(id);
const escapeHTML=s=>String(s??'').replace(/[&<>"']/g, x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[x]));
const isFiniteNumber=x=>x!==null&&x!==undefined&&x!==''&&Number.isFinite(Number(x));
const state={data:null,meta:null,defaults:{},selectedId:null,mode:'baseline',scenarioMode:'baseline',areaView:'baseline',workspace:'scenario',mapLoaded:false,demo:false,scoreRanges:{baseline:null,gap:null,combined:null},
  settings:{weights:{},moveNeeds:false,moveCommunity:false,baselineShare:50}};
// An API-key-free vector basemap lets MapLibre place actual street and place
// labels above the analysis cells. Raster OSM is a fallback only when the
// external vector style cannot be loaded; raster labels cannot be separated.
const VECTOR_STYLE_URL='https://tiles.openfreemap.org/styles/positron';
const fallbackRasterStyle={version:8,sources:{
  gray:{type:'raster',tiles:['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],tileSize:256,
    attribution:'© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>'}
},layers:[
  {id:'neutral-background',type:'background',paint:{'background-color':'#e5e8e8'}},
  {id:'gray-basemap',type:'raster',source:'gray',paint:{
    'raster-opacity':.9,'raster-saturation':-1,'raster-contrast':-.18,
    'raster-brightness-min':.14,'raster-brightness-max':.99}}
]};
let map;
let mappedDataset=null;
let nativeLabelAnchor=null;
let nativeBasemapVisibility=[];
let vectorBasemapLoaded=false;
let rasterFallbackUsed=false;
let drawingArea=false;

function addOverlayLayer(layer){
 // The symbol layers of the vector basemap stay ABOVE all thematic and
 // reference overlays. MapLibre handles text placement and road rotation.
 map.addLayer(layer,nativeLabelAnchor||undefined);
}
function setBasemapVisibility(){
 if(!state.mapLoaded)return;
 const show=$('basemapChoice').value!=='plain';
 for(const entry of nativeBasemapVisibility){
  if(map.getLayer(entry.id))map.setLayoutProperty(entry.id,'visibility',show?entry.visibility:'none');
 }

}

// Map scores keep their original 1–5 numeric meaning; ONLY their colour is
// rescaled to the observed range of valid cells in the active scenario.
// Render endpoints explicitly: the maximum-scoring cell must always be #006837.
const LOW_COLOUR = SCORE_STOPS[0][1];
const HIGH_COLOUR = SCORE_STOPS[SCORE_STOPS.length-1][1];
const EMPTY_COLOUR = '#dce3e1';
// Palette contains 9 sampled ArcGIS colours, ordered Gap low→high × Baseline low→high.
const BIVARIATE3=BIVARIATE;
const FACTOR_COLOURS=['#e9f5fb','#b9dfec','#74b5cf','#2d88b0','#084b78'];
let hoveredFactor=null,hoverTimer=0;
const factorStatsCache=new Map();
function observedRange(mode){
 const range=state.scoreRanges?.[mode];
 return range && Number.isFinite(range.min) && Number.isFinite(range.max) ? range : null;
}
function displayRange(mode){return observedRange(mode)||{min:1,max:5};}
function scoreGradient(){
 return `linear-gradient(to right,${SCORE_STOPS.map(([score,hex])=>`${hex} ${(score-1)*25}%`).join(',')})`;
}
function stretchedColourExpression(scoreExpression,mode){
 const {min,max}=displayRange(mode);
 const spread=max-min;
 // A single unique score cannot have a meaningful relative gradient. It is
 // nonetheless the (joint) maximum and receives the darkest green.
 if(spread<=1e-10){return ['let','v',scoreExpression,
    ['case',['<',['var','v'],1],EMPTY_COLOUR,HIGH_COLOUR]];}
 // Map the observed min and max onto 0 and 1, then interpolate every colour
 // stop of the nine-colour ramp. Explicit endpoint conditions also protect
 // against tiny floating-point differences between JS and MapLibre evaluation.
 const normalized=['/', ['-', ['var','v'],min],spread];
 const stops=SCORE_STOPS.flatMap(([score,hex])=>[(score-1)/4,hex]);
 const endTolerance=Math.max(1e-9,spread*1e-7);
 return ['let','v',scoreExpression,['case',
   ['<',['var','v'],1],EMPTY_COLOUR,
   ['>=',['var','v'],max-endTolerance],HIGH_COLOUR,
   ['<=',['var','v'],min+endTolerance],LOW_COLOUR,
   ['interpolate',['linear'],normalized,...stops]]];
}
// MapLibre evaluates weights as a paint expression. The polygons and their
// attributes are uploaded ONCE; adjusting weights never retransmits the
// GeoJSON dataset. This is considerably faster for citywide layers.
function scoreValueExpr(factor){return ['to-number',['get',factor.id],0];}
function scoreIsValidExpr(factor){
 const v=scoreValueExpr(factor);
 return ['all',['has',factor.id],['>=',v,1],['<=',v,5]];
}
function sumExpression(items){return !items.length?0:items.length===1?items[0]:['+',...items];}
function stageExpression(stage){
 if(!state.meta)return -1;
 const nums=[],dens=[];
 for(const f of state.meta.factors){
   if(currentStage(f,state.settings)!==stage)continue;
   const w=Math.max(0,Number(state.settings.weights[f.id]??5));if(!w)continue;
   const valid=scoreIsValidExpr(f);
   const source=scoreValueExpr(f);
   const moved=f.stage==='Baseline'&&stage==='Gap';
   nums.push(['case',valid,['*',w,moved?['-',6,source]:source],0]);
   dens.push(['case',valid,w,0]);
 }
 if(!nums.length)return -1;
 return ['let','den',sumExpression(dens),['case',['>', ['var','den'],0],
   ['/',sumExpression(nums),['var','den']],-1]];
}
function mapScoreExpr(mode){
 if(mode==='baseline')return stageExpression('Baseline');
 if(mode==='gap')return stageExpression('Gap');
 const b=stageExpression('Baseline'),g=stageExpression('Gap');
 if(mode==='combined'){
   const blend=Math.min(1,Math.max(0,Number(state.settings.baselineShare??50)/100));
   if(blend===1)return b;if(blend===0)return g;
   return ['let','b',b,'g',g,['case',
     ['all',['>=',['var','b'],1],['>=',['var','g'],1]],
     ['+',['*',blend,['var','b']],['*',1-blend,['var','g']]],-1]];
 }
 return null;
}
function bivariateClassExpr(value,mode){
 // Equal thirds of the OBSERVED score range, independently for both axes.
 // Values at/above the observed maximum fall in class 2; ties are class 1.
 const {min,max}=displayRange(mode);
 const spread=max-min;
 if(spread<=1e-10)return 1;
 return ['case',
   ['<',value,min+spread/3],0,
   ['<',value,min+2*spread/3],1,
   2];
}
function bivariateFillExpression(){
 const b=stageExpression('Baseline'),g=stageExpression('Gap');
 const code=['+', ['*',3,bivariateClassExpr(['var','g'],'gap')],bivariateClassExpr(['var','b'],'baseline')];
 return ['let','b',b,'g',g,['case',
   ['any',['<',['var','b'],1],['<',['var','g'],1]],EMPTY_COLOUR,
   ['match',code,...BIVARIATE3.flatMap((hex,i)=>[i,hex]),EMPTY_COLOUR]]];
}
function factorPreviewStats(f){
 const key=f.id;
 if(factorStatsCache.has(key))return factorStatsCache.get(key);
 const rawField='V'+f.id.substring(1);
 const features=state.data?.features||[];
 let field=rawField,valid=0,min=Infinity,max=-Infinity;
 function track(column,score){
   min=Infinity;max=-Infinity;valid=0;
   for(const feature of features){
     const v=feature.properties?.[column];
     if(v===null||v===undefined||v===''||!Number.isFinite(Number(v)))continue;
     const n=Number(v);if(score&&(n<1||n>5))continue;
     min=Math.min(min,n);max=Math.max(max,n);valid++;
   }
 }
 track(rawField,false);
 const raw=valid>0;
 if(!raw){field=f.id;track(field,true);}
 const result={factor:f,field,raw,valid,min,max};
 factorStatsCache.set(key,result);
 return result;
}
function factorPreviewExpression(stats){
 if(!stats||!stats.valid)return EMPTY_COLOUR;
 const v=['to-number',['get',stats.field],-1000000];
 const valid=['all',['has',stats.field],['!=',['get',stats.field],null],['>=',v,stats.min],['<=',v,stats.max]];
 if(stats.max-stats.min<=1e-10)return ['case',valid,FACTOR_COLOURS[3],EMPTY_COLOUR];
 const stops=FACTOR_COLOURS.flatMap((hex,i)=>[stats.min+(stats.max-stats.min)*i/4,hex]);
 return ['case',valid,['interpolate',['linear'],v,...stops],EMPTY_COLOUR];
}
function fillExpression(mode){
 if(!state.meta)return EMPTY_COLOUR;
 if(hoveredFactor)return factorPreviewExpression(factorPreviewStats(hoveredFactor));
 if(mode==='combined')return bivariateFillExpression();
 return stretchedColourExpression(mapScoreExpr(mode),mode);
}
function paintMapColors(){
 if(!state.mapLoaded||!map.getLayer('scores'))return;
 const show=state.mode!=='none';
 // When hidden, leave the source and area polygons intact; changing the view
 // must not re-upload GeoJSON or recalculate scenario/area scores.
 map.setLayoutProperty('scores','visibility',show?'visible':'none');
 if(map.getLayer('selection'))map.setLayoutProperty('selection','visibility',show?'visible':'none');
 if(show)map.setPaintProperty('scores','fill-color',fillExpression(state.mode));
}
function mapModeLabel(mode){return mode==='none'?'ANALYSIS GRID HIDDEN':mode==='combined'?'BASELINE × GAP':mode.toUpperCase()+' SCORE';}
function setMapView(next){
 if(!['baseline','gap','combined','none'].includes(next))return;
 // A factor preview must end even when both workspaces display the same mode.
 cancelFactorHover();
 if(state.mode===next)return;
 state.mode=next;
 $('mapContext').textContent=mapModeLabel(next);
 legend();
 if(state.data)scheduleUpdate('paint');
 else paintMapColors();
}

function cancelFactorHover(){
 clearTimeout(hoverTimer);
 if(!hoveredFactor)return;
 hoveredFactor=null;$('factorPreviewBanner').hidden=true;legend();paintMapColors();
 $('mapContext').textContent=mapModeLabel(state.mode);
}
function requestFactorHover(f){
 clearTimeout(hoverTimer);
 if(hoveredFactor?.id===f.id)return;
 hoverTimer=setTimeout(()=>{
   if(!state.data||!scoresCalculated)return;
   hoveredFactor=f;
   const stats=factorPreviewStats(f);
   $('factorPreviewBanner').hidden=false;
   $('factorPreviewBanner').textContent=`Factor preview · ${f.name} · ${stats.raw?'Original source data':'1–5 factor score'} · ${stats.valid.toLocaleString()} cells`;
   $('mapContext').textContent='INPUT FACTOR PREVIEW';
   legend();paintMapColors();
 },130);
}
function createMap(){
  if(!window.maplibregl){$('loading').innerHTML='<h2>Map library unavailable</h2><p>Connect to the internet to load the MapLibre library, or vendor it for offline use.</p>';return;}
  map = new maplibregl.Map({container:'map',style:VECTOR_STYLE_URL,center:[-123.12,49.25],zoom:11.5,
    attributionControl:false,pitch:0,maxPitch:45});
  map.addControl(new maplibregl.NavigationControl({showCompass:false}),'bottom-right');
  map.addControl(new maplibregl.AttributionControl({compact:false}),'bottom-right');
  // Preserve existing grid functionality if the public vector style is blocked.
  // Fallback occurs only before the first successful map load.
  map.on('error',e=>{
    if(!state.mapLoaded&&!rasterFallbackUsed){
      console.warn('Vector basemap unavailable, using OpenStreetMap raster fallback:',e?.error||e);
      rasterFallbackUsed=true;
      map.setStyle(fallbackRasterStyle);
    }
  });
  map.on('load',()=>{
    state.mapLoaded=true;
    vectorBasemapLoaded=!rasterFallbackUsed;
    const baseLayers=map.getStyle().layers||[];
    nativeBasemapVisibility=baseLayers.map(layer=>({id:layer.id,visibility:layer.layout?.visibility||'visible'}));
    // Place the grid directly UNDER the first basemap symbol. MapLibre's
    // built-in label collision/curved-road placement remains untouched.
    const firstSymbol=baseLayers.find(layer=>layer.type==='symbol');
    nativeLabelAnchor=vectorBasemapLoaded?(firstSymbol?.id||null):null;
    map.addLayer({id:'plain-gray-background',type:'background',paint:{'background-color':'#e5e8e8'}},baseLayers[0]?.id);
    setBasemapVisibility();
    map.addSource('cells',{type:'geojson',data:{type:'FeatureCollection',features:[]},generateId:false});
    addOverlayLayer({id:'scores',type:'fill',source:'cells',paint:{'fill-color':fillExpression(state.mode),'fill-opacity':1}});
    addOverlayLayer({id:'selection',type:'line',source:'cells',paint:{'line-color':'#102e3d','line-width':2.8,'line-opacity':1},filter:['==',['get','GRID_ID'],'__none__']});
    map.on('click','scores',e=>{if(!drawingArea && e.features?.length){state.selectedId=e.features[0].properties.GRID_ID;updateSelection();}});
    initializeAreaLayers();
    map.on('mouseenter','scores',()=>map.getCanvas().style.cursor='pointer');
    map.on('mouseleave','scores',()=>{if(!drawingArea)map.getCanvas().style.cursor='';});
    if(state.data)updateMap(true,scoresCalculated?updateRevision:null);
  });
}
function makeBounds(fc){const bounds=new maplibregl.LngLatBounds();let found=false;
 function walk(arr){if(typeof arr?.[0]==='number'){bounds.extend(arr);found=true;}else if(Array.isArray(arr)){for(const a of arr)walk(a);}}
 for(const f of fc.features)walk(f.geometry.coordinates);
 return found?bounds:null;
}
// Incremental recalculation lets the browser display a genuine progress indicator
// and accept more edits while processing a large citywide GeoJSON file.
// The revision token discards obsolete calculations and obsolete map-idle events.
let updateRevision=0, updateTimer=0, revisionStartedAt=0;
let needsFullScores=true, needsCombinedScore=true, scoresCalculated=false;
let pendingFit=false, cachedBounds=null, mapRenderTimeout=0;
function setUpdateStatus(phase,message,percent=null){
 const pill=$('mapUpdateStatus'),copy=$('sidebarUpdateStatus'),label=$('updateStatusText');
 if(!pill || !label)return;
 const busy=phase==='busy';
 pill.hidden=false;
 pill.dataset.phase=phase;
 pill.setAttribute('aria-busy',String(busy));
 label.textContent=message;
 if(copy){copy.textContent=message;copy.dataset.phase=phase;}
 const bar=$('updateProgressBar');
 if(bar){bar.classList.toggle('indeterminate',busy&&percent===null);
   bar.style.width=percent===null?(busy?'35%':'100%'):`${Math.max(0,Math.min(100,percent))}%`;}
 const exportBtn=$('exportScenario');if(exportBtn)exportBtn.disabled=busy;
}
function scheduleUpdate(kind='full',immediate=false){
 if(!state.data||!state.meta)return;
 if(kind==='full')needsFullScores=true;
 if(kind==='full'||kind==='blend'){needsCombinedScore=true;areaResultsDirty=true;++areaRunRevision;if(drawnAreas.length)areaMessage('Recalculating scenario scores before area summaries…',true);}
 const revision=++updateRevision;
 revisionStartedAt=performance.now();
 clearTimeout(updateTimer);cancelRenderWait();
 setUpdateStatus('busy','Updating map…',null);
 // Wait briefly to combine consecutive arrow clicks or drag events.
 // The indicator is set synchronously, before expensive scoring starts.
 updateTimer=setTimeout(()=>calculateRevision(revision),immediate?0:170);
}
function calculateRevision(revision){
 if(revision!==updateRevision||!state.data||!state.meta)return;
 const full=needsFullScores,blend=needsCombinedScore;
 if(!full&&!blend){finishCalculation(revision);return;}
 const features=state.data.features;
 const factors=state.meta.factors;
 // Snapshot the scenario: a change mid-calculation cancels this run.
 const settings={...state.settings,weights:{...state.settings.weights}};
 // Fixed spreadsheet-default reference: original factor routing, workbook
 // weights and a 50/50 Combined balance, independent of the live scenario.
 const benchmarkSettings={weights:state.defaults,moveNeeds:false,moveCommunity:false,baselineShare:50};
 const share=Math.max(0,Math.min(1,Number(settings.baselineShare)/100));
 let i=0,shown=-1;
 // Determine observed score extrema while already iterating the cells: no
 // second costly pass, and no change to the numeric scores or CSV export.
 const ranges=full ? {baseline:{min:Infinity,max:-Infinity},gap:{min:Infinity,max:-Infinity},combined:{min:Infinity,max:-Infinity}}
                   : {combined:{min:Infinity,max:-Infinity}};
 function track(key,value){
  if(value===null || !Number.isFinite(value))return;
  const range=ranges[key];range.min=Math.min(range.min,value);range.max=Math.max(range.max,value);
 }
 function chunk(){
  if(revision!==updateRevision)return;
  const until=performance.now()+11;
  while(i<features.length && performance.now()<until){
   const p=features[i++].properties;
   // Calculate the benchmark once per grid cell per loaded dataset. Blend
   // changes and later weight edits reuse these original scores unchanged.
   if(!Object.prototype.hasOwnProperty.call(p,'__defaultBase')){
    const ref=computeScores(p,factors,benchmarkSettings);
    p.__defaultBase=ref.baseline;
    p.__defaultGap=ref.gap;
    p.__defaultCombined=ref.combined;
   }
   if(full){
    const r=computeScores(p,factors,settings);
    p.__base=r.baseline;p.__gap=r.gap;p.__combined=r.combined;p.__biv=r.biv;
    track('baseline',r.baseline);track('gap',r.gap);track('combined',r.combined);
   }else{
    // Changing only the Combined balance does not need 26 factor evaluations.
    const b=p.__base,g=p.__gap;
    p.__combined=share===1?b:share===0?g:(b!==null&&g!==null?b*share+g*(1-share):null);
    track('combined',p.__combined);
   }
  }
  if(revision!==updateRevision)return;
  const progress=features.length?Math.round(i*100/features.length):100;
  const decade=Math.floor(progress/10);
  if(decade!==shown){shown=decade;setUpdateStatus('busy',`Calculating scores… ${progress}%`,progress);}
  if(i<features.length){requestAnimationFrame(chunk);return;}
  if(full)needsFullScores=false;
  needsCombinedScore=false;
  scoresCalculated=true;
  // Commit extrema only after an entire, non-cancelled revision has finished.
  for(const [mode,range] of Object.entries(ranges)){
   state.scoreRanges[mode]=Number.isFinite(range.min)&&Number.isFinite(range.max)?range:null;
  }
  legend();
  finishCalculation(revision);
 }
 requestAnimationFrame(chunk);
}
function finishCalculation(revision){
 if(revision!==updateRevision)return;
 updateSelection();
 updateWeightShares();
 if(areaResultsDirty){areaResultsDirty=false;recalculateAreas();}
 setUpdateStatus('busy',state.mapLoaded?'Rendering updated map…':'Waiting for map to load…',null);
 if(state.mapLoaded)updateMap(false,revision);
}
let waitingIdle=null;
function cancelRenderWait(){
 if(waitingIdle&&map){map.off('idle',waitingIdle);waitingIdle=null;}
 clearTimeout(mapRenderTimeout);
}
function mapReady(revision){
 if(revision!==updateRevision)return;
 cancelRenderWait();
 const seconds=(Math.max(0,performance.now()-revisionStartedAt)/1000).toFixed(1);
 setUpdateStatus('done',`✓ Map rendered · ${seconds} s`,100);
}
// A MapLibre 'render' event is NOT a completion event: it can occur before
// the GeoJSON worker, symbol placement or subsequent style update finishes.
// 'idle' guarantees the committed style and visible tiles are fully drawn.
function awaitMapRender(revision){
 if(revision!==updateRevision)return;
 cancelRenderWait();
 const onIdle=()=>{
   if(revision!==updateRevision)return;
   if(!map.loaded()||map.isMoving()){
     map.once('idle',onIdle);waitingIdle=onIdle;return;
   }
   waitingIdle=null;
   // Allow browser compositor to present the completed map canvas.
   requestAnimationFrame(()=>requestAnimationFrame(()=>mapReady(revision)));
 };
 waitingIdle=onIdle;
 map.once('idle',onIdle);
 map.triggerRepaint();
 mapRenderTimeout=setTimeout(()=>{
  if(revision===updateRevision && $('mapUpdateStatus').dataset.phase==='busy')
   setUpdateStatus('busy','Still rendering map… waiting for layers and tiles',null);
 },7500);
}
let throttleHandle=0;
function updateMap(zoom=false,revision=null){
 if(!state.data)return;
 pendingFit=pendingFit||zoom;
 if(!state.mapLoaded)return;
 clearTimeout(throttleHandle);
 throttleHandle=setTimeout(()=>{
  if(revision!==null && revision!==updateRevision)return;
  const source=map.getSource('cells');
  const uploading=!!source && mappedDataset!==state.data;
  if(uploading){source.setData(state.data);mappedDataset=state.data;}
  // Extent-only actions don't need to rebuild an expensive map expression.
  if(revision!==null||uploading)paintMapColors();
  if(pendingFit){
   if(!cachedBounds)cachedBounds=makeBounds(state.data);
   if(cachedBounds)map.fitBounds(cachedBounds,{padding:65,duration:650,maxZoom:14});
   pendingFit=false;
  }
  if(revision!==null)awaitMapRender(revision);
 },40);
}
function selFeature(){return state.data?.features.find(f=>f.properties.GRID_ID===state.selectedId)||null;}
function updateSelection(){
 if(!state.data)return;
 const selected=selFeature();
 const p=selected?.properties;
 $('cellTitle').textContent=selected?'Cell '+String(p.GRID_ID):'Citywide cell averages';
 $('clearCell').style.visibility=selected?'visible':'hidden';
 const s=selected?{baseline:p.__base,gap:p.__gap,combined:p.__combined}:summarize(state.data.features);
 $('metricBase').textContent=prettyScore(s.baseline);$('metricGap').textContent=prettyScore(s.gap);$('metricCombined').textContent=prettyScore(s.combined);
 for(const [mode,id] of [['baseline','metricBase'],['gap','metricGap'],['combined','metricCombined']])paintScoreCard($(id).parentElement,s[mode],mode);
 if(state.mapLoaded)map.setFilter('selection',['==',['get','GRID_ID'],selected?String(p.GRID_ID):'__none__']);
 const el=$('cellDetail');
 if(!selected){el.innerHTML='<div class="muted">Select a cell to see housing composition, factor scores and available original source values. The figures above are arithmetic averages of scored grid cells, not population-weighted statistics.</div>';}
 else{
  const house=state.meta.housing||{};
  const lines=[];
  const groups=[['Existing housing type shares',[['Low','R_EX_LOW'],['Medium','R_EX_MID'],['High','R_EX_HIGH']]],
                ['Pipeline housing type shares',[['Low','R_PL_LOW'],['Medium','R_PL_MID'],['High','R_PL_HIGH']]],
                ['Existing tenure shares',[['Rental','R_EX_RENT'],['BMR','R_EX_BMR'],['NMH','R_EX_NMH']]],
                ['Pipeline tenure shares',[['Rental','R_PL_RENT'],['BMR','R_PL_BMR'],['NMH','R_PL_NMH']]]];
  for(const [title,props] of groups){
    if(props.some(([,key])=>isFiniteNumber(p[key]))){
     const targets=title.startsWith('Existing housing type')?house.targets?.['Existing Housing Types']:
                   title.startsWith('Pipeline housing type')?house.targets?.['Pipeline Housing Types']:null;
     const description=props.map(([name,key])=>`${escapeHTML(name)} <b>${ratioText(p[key])}</b>`).join(' · ');
     let sub=targets?`<p>Type targets: Low ${escapeHTML(targets['Low density']??'—')}%, Medium ${escapeHTML(targets['Medium density']??'—')}%, High ${escapeHTML(targets['High density']??'—')}%</p>`:'';
     lines.push(`<p><b>${escapeHTML(title)}</b><br>${description}</p>${sub}`);
    }
  }
  if(isFiniteNumber(p.PIPE_DWELLINGS))lines.push(`<p><b>Proposed dwelling units in source DA: ${Number(p.PIPE_DWELLINGS).toLocaleString(undefined,{maximumFractionDigits:0})}</b><br>Ratios are based on proposed dwelling units at the time of data collection in the dissemination area. This is not the number of homes within this ${Number(state.meta?.grid_size_m)||100} m cell.</p>`);
  if(lines.length===0)lines.push('<p>Housing share source fields are not available for this cell.</p>');
  el.innerHTML=`<div class="score-comparison"><div data-mode="baseline"><small>Baseline</small><strong>${prettyScore(p.__base)}</strong></div><div data-mode="gap"><small>Gap</small><strong>${prettyScore(p.__gap)}</strong></div><div data-mode="combined"><small>Combined</small><strong>${prettyScore(p.__combined)}</strong></div></div><details class="housing-details" open><summary>Housing composition & source context</summary>${lines.join('')}<p><small>Tenure shares overlap and do not necessarily total 100%.</small></p></details>`;
 }
 if(selected)for(const mode of ['baseline','gap','combined'])paintScoreCard(el.querySelector(`.score-comparison [data-mode="${mode}"]`),p['__'+(mode==='baseline'?'base':mode)],mode);
 for(const f of state.meta.factors){
  const badge=$('score_'+f.id);if(!badge)continue;
  const value=selected?adjustedFactorScore(p,f,state.settings):null;
  badge.textContent=value===null?'—':prettyScore(value);
  badge.classList.toggle('missing',value===null);
  badge.title=value===null?(selected?'Score unavailable for this cell':'Select a grid cell to inspect its factor scores'):
     `${f.name}: ${prettyScore(value)} / 5 (absolute factor score)`;
  const c=value===null?null:colorForScore(value);
  badge.style.backgroundColor=c||'';
  badge.style.color=value===null?'':scoreTextColor(c);
  badge.setAttribute('aria-label',badge.title);
  const native=$('native_'+f.id);
  if(native){
   const orig=selected&&p['V'+f.id.substring(1)];
   if(selected && isFiniteNumber(orig)){
     let display=Number(orig).toLocaleString(undefined,{maximumFractionDigits:2});
     const lookup=f.native_codes || null;
     if(lookup)display=lookup[String(Math.round(orig))] || display;
     native.textContent='Source: '+display;
     native.title=f.description||`Original source value summarized to ${Number(state.meta?.grid_size_m)||100} m`;
   }else {native.textContent='';native.title='Original source value not available';}
  }
 }
}
// Factor records retain the row order of their original spreadsheet.
// They carry the spreadsheet's original_weight_pct (no equal-weight reset).
function defaultWeights(factors){
 const result={};
 for(const stage of ['Baseline','Gap']){
   const group=factors.filter(f=>f.stage===stage);
   // New exports preserve the workbook's literal weights, even if its total
   // is not 100%; display the discrepancy rather than silently normalizing it.
   if(group.every(f=>f.default_weight!==undefined && Number.isFinite(Number(f.default_weight)))){
     for(const f of group)result[f.id]=Math.max(0,Math.min(100,Math.round(Number(f.default_weight))));
     continue;
   }
   const values=group.map(f=>Math.max(0,Number(f.original_weight_pct??0)));
   // Earlier exports included percentage weights but not the raw workbook value.
   if(!values.some(x=>x>0)){
     for(const f of group)result[f.id]=0;
     continue;
   }
   // Largest remainder rounding gives integer values that total 100 for
   // percentage-based metadata, while preserving exact integer inputs.
   const exact=values.map(v=>100*v/values.reduce((a,b)=>a+b,0));
   const floors=exact.map(Math.floor);
   const remainder=100-floors.reduce((a,b)=>a+b,0);
   const ranked=exact.map((n,i)=>({i,frac:n-floors[i]})).sort((a,b)=>b.frac-a.frac||a.i-b.i);
   for(let k=0;k<remainder;k++)floors[ranked[k].i]++;
   group.forEach((f,i)=>{result[f.id]=floors[i];});
 }
 return result;
}
function colorForScore(value){
 const val=Math.max(1,Math.min(5,Number(value)));
 const pos=Math.min(SCORE_STOPS.length-2,Math.floor((val-1)*2));
 const [av,a]=SCORE_STOPS[pos], [bv,b]=SCORE_STOPS[pos+1];
 const t=Math.max(0,Math.min(1,(val-av)/(bv-av)));
 function mix(i){return Math.round(parseInt(a.slice(i,i+2),16)*(1-t)+parseInt(b.slice(i,i+2),16)*t).toString(16).padStart(2,'0');}
 return '#'+mix(1)+mix(3)+mix(5);
}
function scoreTextColor(hex){if(!hex)return '';
 const channels=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(x=>x<=.04045?x/12.92:Math.pow((x+.055)/1.055,2.4));
 return channels[0]*.2126+channels[1]*.7152+channels[2]*.0722>.34?'#23373b':'#fff';
}
// The prominent Baseline, Gap and Combined values use the *same scenario-
// relative min/max stretch* as the map. Factor badges remain absolute 1–5.
function relativeScoreColor(value,mode){
 if(value===null || !Number.isFinite(Number(value)))return null;
 const range=displayRange(mode);
 if(range.max-range.min<=1e-10)return HIGH_COLOUR;
 const normalized=Math.max(0,Math.min(1,(Number(value)-range.min)/(range.max-range.min)));
 return colorForScore(1+4*normalized);
}
function paintScoreCard(element,value,mode){
 if(!element)return;
 const color=relativeScoreColor(value,mode);
 element.style.backgroundColor=color||'#edf1f1';
 element.style.color=color?scoreTextColor(color):'#7c8d92';
 element.style.borderColor=color||'#dce5e5';
 element.title=color?`${mode} ${prettyScore(value)} / 5. Colour is relative to the observed ${mode} score range on the map.`:`No valid ${mode} score`;
}
function formatDelta(delta){return delta>0?`+${delta}`:String(delta);}
function setWeight(f,raw){
 const n=Number(raw);
 if(!Number.isFinite(n))return;
 state.settings.weights[f.id]=Math.max(0,Math.min(100,Math.round(n)));
 const input=$('weight_'+f.id);if(input)input.value=state.settings.weights[f.id];
 updateWeightShares();
 scheduleUpdate('full');
}
function addFactorRows(holder,stage){
 const factors=state.meta.factors.filter(f=>currentStage(f,state.settings)===stage);
 // Keep the original row order, including repeated category sections.
 // Grouping by unique category would relocate later Environmental rows.
 let previousCategory=null;
 for(const f of factors){
   if(f.category!==previousCategory){
     const heading=document.createElement('div');heading.className='category-name';heading.textContent=f.category;
     holder.append(heading);
     previousCategory=f.category;
   }
     const row=document.createElement('div');row.className='factor-row';
     const label=document.createElement('div');label.className='factor-title';
     const labelName=document.createElement('div');labelName.textContent=f.name;label.append(labelName);
     label.classList.add('factor-hover-target');label.tabIndex=0;
     label.setAttribute('aria-label',`Preview ${f.name} source data on map`);
     label.addEventListener('pointerenter',()=>requestFactorHover(f));
     label.addEventListener('pointerleave',()=>{clearTimeout(hoverTimer);if(hoveredFactor?.id===f.id)cancelFactorHover();});
     label.addEventListener('focus',()=>requestFactorHover(f));
     label.addEventListener('blur',()=>{clearTimeout(hoverTimer);if(hoveredFactor?.id===f.id)cancelFactorHover();});
     const raw=document.createElement('div');raw.id='native_'+f.id;raw.className='native-text';label.append(raw);
     if(f.description)label.title=f.description;
     const controls=document.createElement('div');controls.className='weight-control';
     const stepper=document.createElement('div');stepper.className='weight-stepper';
     const field=document.createElement('input');field.type='number';field.min='0';field.max='100';field.step='1';field.inputMode='numeric';
     field.id='weight_'+f.id;field.className='weight-input';field.value=state.settings.weights[f.id]??0;
     field.setAttribute('aria-label',`Weight in percent for ${f.name}`);
     field.addEventListener('input',()=>{if(field.value!=='' && Number.isFinite(Number(field.value)))setWeight(f,field.value);});
     field.addEventListener('change',()=>{setWeight(f,field.value===''?state.settings.weights[f.id]:field.value);});
     const pct=document.createElement('span');pct.className='percent-symbol';pct.textContent='%';
     const arrows=document.createElement('div');arrows.className='weight-arrows';
     for(const [delta,sign] of [[1,'▲'],[-1,'▼']]){
       const btn=document.createElement('button');btn.type='button';btn.className='weight-arrow';btn.textContent=sign;
       btn.setAttribute('aria-label',`${delta>0?'Increase':'Decrease'} ${f.name} by one percentage point`);
       btn.addEventListener('click',()=>setWeight(f,(state.settings.weights[f.id]??0)+delta));
       arrows.append(btn);
     }
     stepper.append(field,pct,arrows);
     const note=document.createElement('div');note.className='weight-default-note';
     note.innerHTML=`<span>Default ${state.defaults[f.id]??0}%</span><strong id="delta_${f.id}" class="weight-delta">0</strong>`;
     controls.append(stepper,note);
     const score=document.createElement('div');score.className='weight-label';
     score.innerHTML=`<span class="factor-value score-chip missing" id="score_${f.id}" title="Select a grid cell to show its factor score">—</span>`;
     row.append(label,controls,score);holder.append(row);
 }
 return factors.length;
}
function buildWeights(){
 if(!state.meta)return;
 cancelFactorHover();
 const base=$('baselineFactorList'),gap=$('gapFactorList');base.replaceChildren();gap.replaceChildren();
 const bn=addFactorRows(base,'Baseline'),gn=addFactorRows(gap,'Gap');
 $('gapMovementNote').hidden=gn<=state.meta.factors.filter(f=>f.stage==='Gap').length;
 $('tabBaseline').querySelector('small').textContent=`${bn} factors`;
 $('tabGap').querySelector('small').textContent=`${gn} factors`;
 updateWeightShares();
 updateSelection(); // Reapply selected-cell colour-coded scores after moving factor DOM rows.
}
function updateWeightShares(){
 if(!state.meta)return;
 const totals=stageWeightTotals(state.meta.factors,state.settings);
 for(const stage of ['Baseline','Gap']){
   const status=$(stage.toLowerCase()+'WeightStatus');
   if(!status)continue;
   const total=totals[stage];const diff=total-100;
   status.classList.toggle('off-target',diff!==0);
   status.innerHTML=`<span>${stage} total <strong>${total}%</strong></span><span class="total-status">${diff===0?'✓ Total = 100%':`⚠ ${formatDelta(diff)} point${Math.abs(diff)===1?'':'s'} from 100%`}</span>`;
 }
 for(const f of state.meta.factors){
   const el=$('delta_'+f.id);if(!el)continue;
   const delta=(state.settings.weights[f.id]??0)-(state.defaults[f.id]??0);
   el.textContent=delta===0?'±0':formatDelta(delta);
   el.classList.toggle('changed',delta!==0);
   el.classList.toggle('positive',delta>0);
   el.classList.toggle('negative',delta<0);
 }
}
function activateTab(next){
 if(!['baseline','gap','combined'].includes(next))return;
 state.scenarioMode=next;
 for(const tab of ['baseline','gap','combined']){
  const active=tab===next;const cap=tab[0].toUpperCase()+tab.slice(1);
  const button=$('tab'+cap),panel=$('panel'+cap);
  button.classList.toggle('active',active);button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1;
  panel.hidden=!active;
 }
 if(state.workspace==='scenario')setMapView(next);
}
function legend(){
 const el=$('legend');el.hidden=!state.data||state.mode==='none';
 if(!state.data||state.mode==='none')return;
 if(hoveredFactor){
  const stats=factorPreviewStats(hoveredFactor);
  const label=stats.raw?'Original source value':'Factor score (1–5)';
  const min=stats.valid?Number(stats.min).toLocaleString(undefined,{maximumFractionDigits:2}):'—';
  const max=stats.valid?Number(stats.max).toLocaleString(undefined,{maximumFractionDigits:2}):'—';
  el.innerHTML=`<h4>${escapeHTML(hoveredFactor.name)}</h4><div class="legend-gradient" style="background:linear-gradient(to right,${FACTOR_COLOURS.join(',')})"></div><div class="legend-labels"><span>${min} · Low</span><span>${max} · High</span></div><div class="legend-note">${label}. Blue palette is independent of scenario scoring. Grey = missing data. Move away to restore the map.</div>`;
  return;
 }
 if(state.mode==='combined'){
  const {min:bmin,max:bmax}=displayRange('baseline'),{min:gmin,max:gmax}=displayRange('gap');
  // Display rows high→low Gap. Columns increase low→high Baseline.
  // The yellow and cyan component ramps and the corner colours match the
  // supplied ArcGIS Pro reference, transposed into the agreed axis layout.
  const swatches=[];
  for(let r=2;r>=0;r--)for(let col=0;col<3;col++)swatches.push(`<span title="Baseline ${['Low','Mid','High'][col]} / Gap ${['Low','Mid','High'][r]}" style="background:${BIVARIATE3[r*3+col]}"></span>`);
  el.innerHTML=`<h4>BASELINE &amp; GAP · Combined</h4>
   <div class="bi-key"><span class="bi-key-ramp bi-base-ramp"></span><span>Baseline weighted score</span></div>
   <div class="bi-key"><span class="bi-key-ramp bi-gap-ramp"></span><span>Gap weighted score</span></div>
   <div class="bi-matrix-layout"><div class="bi-y-axis"><span>High</span><strong>Gap</strong><span>Low</span></div>
    <div class="bi-matrix-main"><div class="bi-grid bi-grid-3">${swatches.join('')}</div><div class="bi-x-range"><span>Low</span><span>High</span></div></div></div>
   <div class="bi-x-caption">Baseline weighted score →</div>
   <div class="legend-note">3 classes per axis, stretched independently to observed Baseline (${bmin.toFixed(2)}–${bmax.toFixed(2)}) and Gap (${gmin.toFixed(2)}–${gmax.toFixed(2)}) scores. Colour shows both measures; the Combined slider still controls numeric scores and area summaries.</div>`;
 }else{
  const range=displayRange(state.mode);
  const spread=observedRange(state.mode);
  const degenerate=spread && spread.max-spread.min<=1e-10;
  const label=state.mode==='baseline'?'Baseline':'Gap';
  const minLabel=range.min.toFixed(2), midLabel=((range.min+range.max)/2).toFixed(2), maxLabel=range.max.toFixed(2);
  const ramp=degenerate?`linear-gradient(to right,${HIGH_COLOUR},${HIGH_COLOUR})`:scoreGradient();
  el.innerHTML=`<h4>${label} score · relative colour stretch</h4><div class="legend-gradient" style="background:${ramp}"></div><div class="legend-labels"><span>${minLabel} · Low</span><span>${midLabel}</span><span>${maxLabel} · High</span></div><div class="legend-extremes"><span><i style="background:${LOW_COLOUR}"></i> Lowest</span><span><i style="background:${HIGH_COLOUR}"></i> Highest = darkest green</span></div><div class="legend-note">${degenerate?'All valid cells have the same score, so all are dark green.':spread?'Lowest and highest valid cells use the exact red and dark-green endpoints.':'Temporary 1–5 scale shown while scores load.'} Actual scores are unchanged.</div>`;
 }
}
async function fetchData(demo=false){
 const root=demo?'data/demo_':'data/';
 const urls=demo?['data/demo_meta.json','data/demo_grid.geojson']:['data/meta.json','data/grid.geojson'];
 const responses=await Promise.all(urls.map(u=>fetch(u,{cache:'no-cache'})));
 if(!responses.every(x=>x.ok))throw new Error('The published data files are not available');
 const [meta,geojson]=await Promise.all(responses.map(r=>r.json()));
 if(!Array.isArray(meta.factors)||!Array.isArray(geojson.features)||!geojson.features.length)throw new Error('Invalid or empty model data');
 for(const f of meta.factors){if(!f.id||!f.stage||!f.name)throw new Error('Incomplete factor metadata');}
 clearAllAreas(true);
 cancelFactorHover();factorStatsCache.clear();
 state.demo=demo;state.meta=meta;state.data=geojson;state.selectedId=null;mappedDataset=null;cachedBounds=null;scoresCalculated=false;needsFullScores=true;needsCombinedScore=true;state.scoreRanges={baseline:null,gap:null,combined:null};
 const prior=loadScenarioFromHash();
 state.defaults=defaultWeights(meta.factors);
 state.settings={weights:{...state.defaults},moveNeeds:false,moveCommunity:false,baselineShare:50};
 if(prior){for(const f of meta.factors)if(prior.weights?.[f.id]!==undefined && Number.isFinite(Number(prior.weights[f.id])))state.settings.weights[f.id]=Math.max(0,Math.min(100,Math.round(Number(prior.weights[f.id]))));
   state.settings.moveNeeds=!!prior.moveNeeds;state.settings.moveCommunity=!!prior.moveCommunity;
   state.settings.baselineShare=Math.min(100,Math.max(0,Number(prior.baselineShare??50)));}
 $('moveNeeds').checked=state.settings.moveNeeds;$('moveCommunity').checked=state.settings.moveCommunity;
 $('split').value=state.settings.baselineShare;updateSplit();
 $('loading').hidden=true;
 $('dataTag').textContent=demo?'SYNTHETIC DEMO':'EXPORT · '+(meta.cell_count||geojson.features.length).toLocaleString()+' cells';
 $('dataTag').style.background=demo?'#ffe8c9':'#e9f2f2';
 $('cellCount').textContent=`${geojson.features.length.toLocaleString()} cells`;
 const gridSize=Number(meta.grid_size_m)||100, sourceSize=Number(meta.source_cell_size_m)||10;
 $('selectedCellHeading').textContent=`SELECTED ${gridSize} M GRID CELL`;
 $('cellTitle').textContent=`Choose a ${gridSize} m cell`;
 $('gridSizeFooter').textContent=`${gridSize} m grid · 1–5 scores`;
 $('resolutionNote').textContent=`Scores are averaged from valid ${sourceSize} m analysis pixels in each ${gridSize} m grid polygon. Browser scenarios reweight those scores without rerunning GIS analysis.`;
 $('dataNotes').textContent=`Factor weights default to the source workbook. Export created ${meta.created_utc?new Date(meta.created_utc).toLocaleString():'unknown date'}. Housing shares are fractions (0–1), displayed as percentages. Original workbook targets are embedded in metadata. Scenario changes do not alter the underlying exported data.`;
 $('bottomNote').textContent=demo?'SYNTHETIC DEMO — not Vancouver planning results':`${Number(meta.grid_size_m)||100} m grid · Browser-side scoring · Zero GIS recomputation`;
 state.areaView='baseline';state.scenarioMode='baseline';state.mode='baseline';
 $('mapContext').textContent=mapModeLabel('baseline');
 const viewChoice=document.querySelector('input[name=areaGridView][value=baseline]');if(viewChoice)viewChoice.checked=true;
 buildWeights();activateTab('baseline');legend();scheduleUpdate('full',true);updateMap(true);
}
function updateSplit(){const b=Number($('split').value);$('splitBase').textContent=b+'%';$('splitGap').textContent=(100-b)+'%';$('combinedFormula').textContent=`Combined = ${b}% Baseline + ${100-b}% Gap`;}
function loadScenarioFromHash(){try{if(location.hash.startsWith('#scenario='))return JSON.parse(decodeURIComponent(location.hash.slice(10)));}catch(e){}return null;}
function updateRoutes(){state.settings.moveNeeds=$('moveNeeds').checked;state.settings.moveCommunity=$('moveCommunity').checked;buildWeights();scheduleUpdate('full');}
function setError(message){$('loading').hidden=false;$('loading').querySelector('h2').textContent='Load planning data';
 const p=$('loading').querySelector('p');if(p)p.innerHTML=`${escapeHTML(message)}. Export <code>grid.geojson</code> and <code>meta.json</code> from the ArcGIS tool into the site’s <code>data/</code> folder.`;}
function downloadBlob(blob,name){const a=document.createElement('a');const url=URL.createObjectURL(blob);a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function exportCSV(){if(!state.data)return;const rows=[['GRID_ID','BASELINE','GAP','COMBINED']];
 for(const f of state.data.features){const p=f.properties;rows.push([p.GRID_ID,p.__base??'',p.__gap??'',p.__combined??'']);}
 const text=rows.map(r=>r.join(',')).join('\n');downloadBlob(new Blob([text],{type:'text/csv'}),'planning-opportunity-scenario.csv');}
function resetStage(stage){
 if(!state.meta)return;
 for(const f of state.meta.factors)if(currentStage(f,state.settings)===stage)state.settings.weights[f.id]=state.defaults[f.id]??0;
 buildWeights();scheduleUpdate('full');
}
// -------- User-drawn Area Analysis (visual overlay, never a scoring input) --------
const drawnAreas=[];
let areaIdCounter=0, selectedAreaId=null, drawVertices=[],drawPointer=null;
let drawMode='polygon';
let areaRunRevision=0,areaResultsDirty=false;
function areaMessage(message,busy=false){
 const el=$('areaStatus');if(el){el.textContent=message;el.dataset.busy=String(busy);}
}
function activeWorkspace(next){
 const area=next==='areas';
 state.workspace=area?'areas':'scenario';
 $('scenarioWorkspace').hidden=area;$('areaWorkspace').hidden=!area;
 $('workspaceScenarioTab').classList.toggle('active',!area);
 $('workspaceAreasTab').classList.toggle('active',area);
 $('workspaceScenarioTab').setAttribute('aria-selected',String(!area));
 $('workspaceAreasTab').setAttribute('aria-selected',String(area));
 // Each workspace has an independent map-view selection. The area workspace
 // can hide the grid entirely without hiding the user's drawn polygons.
 setMapView(area?state.areaView:state.scenarioMode);
 if(map && state.mapLoaded)map.resize();
}
function coordsEqual(a,b){return a&&b&&Math.abs(a[0]-b[0])<1e-9&&Math.abs(a[1]-b[1])<1e-9;}
function linesIntersect(a,b,c,d){
 const orient=(p,q,r)=>(q[0]-p[0])*(r[1]-p[1])-(q[1]-p[1])*(r[0]-p[0]);
 const o1=orient(a,b,c),o2=orient(a,b,d),o3=orient(c,d,a),o4=orient(c,d,b);
 return o1*o2<0&&o3*o4<0;
}
function isSimplePolygon(vertices){
 const n=vertices.length;
 for(let i=0;i<n;i++)for(let j=i+1;j<n;j++){
  if(j===i+1||(i===0&&j===n-1))continue;
  if(linesIntersect(vertices[i],vertices[(i+1)%n],vertices[j],vertices[(j+1)%n]))return false;
 }
 return true;
}
function initializeAreaLayers(){
 if(!map.getSource('user-areas'))map.addSource('user-areas',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
 if(!map.getSource('area-draft'))map.addSource('area-draft',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
 addOverlayLayer({id:'user-areas-fill',type:'fill',source:'user-areas',paint:{'fill-color':['coalesce',['get','combined_hex'],EMPTY_COLOUR],'fill-opacity':.78}});
 addOverlayLayer({id:'user-areas-outline',type:'line',source:'user-areas',paint:{'line-color':['case',['==',['get','area_id'],selectedAreaId||'__none__'],'#07445d','#367f96'],'line-width':['case',['==',['get','area_id'],selectedAreaId||'__none__'],3.5,2.2],'line-opacity':.95}});
 addOverlayLayer({id:'area-draft-fill',type:'fill',source:'area-draft',filter:['==',['geometry-type'],'Polygon'],paint:{'fill-color':'#266f92','fill-opacity':.16}});
 addOverlayLayer({id:'area-draft-outline',type:'line',source:'area-draft',filter:['==',['geometry-type'],'Polygon'],paint:{'line-color':'#07445d','line-width':2.5,'line-dasharray':[2,1]}});
 addOverlayLayer({id:'area-draft-line',type:'line',source:'area-draft',filter:['==',['geometry-type'],'LineString'],paint:{'line-color':'#07445d','line-width':3,'line-dasharray':[2,1]}});
 addOverlayLayer({id:'area-draft-vertices',type:'circle',source:'area-draft',filter:['==',['geometry-type'],'Point'],paint:{'circle-color':'#fff','circle-stroke-color':'#07516c','circle-stroke-width':2,'circle-radius':5}});
 map.on('click',onAreaMapClick);
 map.on('dblclick',onAreaDoubleClick);
 map.on('mousemove',onAreaMouseMove);
 refreshAreaMap();
}
function refreshAreaMap(){
 if(!state.mapLoaded || !map?.getSource('user-areas'))return;
 const features=drawnAreas.map(a=>({type:'Feature',properties:{area_id:a.id,name:a.name,combined_score:a.result?.scores.combined??null,combined_hex:relativeScoreColor(a.result?.scores.combined??null,'combined')||EMPTY_COLOUR},geometry:a.geometry}));
 map.getSource('user-areas').setData({type:'FeatureCollection',features});
 if(map.getLayer('user-areas-outline')){
  const isSelected=['==',['get','area_id'],selectedAreaId||'__none__'];
  map.setPaintProperty('user-areas-outline','line-color',['case',isSelected,'#07445d','#367f96']);
  map.setPaintProperty('user-areas-outline','line-width',['case',isSelected,3.5,2.2]);
 }
 refreshDraftMap();
}
function drawingRing(pointer){
 if(drawMode==='polygon')return drawVertices.length>=3?[...drawVertices,drawVertices[0]]:null;
 if(drawVertices.length<1||!pointer)return null;
 return rectangleRing(drawVertices[0],pointer,drawMode==='square');
}
function refreshDraftMap(){
 if(!state.mapLoaded||!map?.getSource('area-draft'))return;
 const features=[];
 if(drawingArea){
  const first=drawVertices[0];
  if(drawMode==='polygon'){
   for(const coord of drawVertices)features.push({type:'Feature',properties:{},geometry:{type:'Point',coordinates:coord}});
   const coords=[...drawVertices];
   if(drawPointer&&coords.length&&!coordsEqual(drawPointer,coords[coords.length-1]))coords.push(drawPointer);
   if(coords.length>=2)features.push({type:'Feature',properties:{},geometry:{type:'LineString',coordinates:coords}});
  }else if(first)features.push({type:'Feature',properties:{},geometry:{type:'Point',coordinates:first}});
  const ring=drawingRing(drawMode==='polygon'?null:drawPointer);
  if(ring)features.push({type:'Feature',properties:{},geometry:{type:'Polygon',coordinates:[ring]}});
 }
 map.getSource('area-draft').setData({type:'FeatureCollection',features});
}
function snappedPointer(event){
 const point=[event.lngLat.lng,event.lngLat.lat];
 if(drawMode!=='polygon'||!drawVertices.length||!(event.originalEvent?.shiftKey||$('rightAngleSnap').checked))return point;
 return orthogonalCoordinate(drawVertices[drawVertices.length-1],point,
  coord=>map.project(coord),xy=>{const ll=map.unproject([xy.x,xy.y]);return [ll.lng,ll.lat];});
}
function onAreaMapClick(event){
 if(!drawingArea)return;
 if(drawMode!=='polygon'){
  const point=[event.lngLat.lng,event.lngLat.lat];
  if(!drawVertices.length){drawVertices=[point];drawPointer=point;refreshDraftMap();
   $('areaDrawHint').textContent=`Click the opposite corner to finish the ${drawMode}.`;}
  else{drawPointer=point;finishDrawingArea();}
  return;
 }
 const coord=snappedPointer(event);
 if(!coordsEqual(coord,drawVertices[drawVertices.length-1]))drawVertices.push(coord);
 drawPointer=null;refreshDraftMap();
 $('finishArea').disabled=drawVertices.length<3;
 $('areaDrawHint').textContent=`${drawVertices.length} corners · Shift snaps right angles · Double-click to finish · Backspace undoes · Esc cancels.`;
}
function onAreaDoubleClick(event){if(!drawingArea||drawMode!=='polygon')return;event.preventDefault();finishDrawingArea();}
function onAreaMouseMove(event){if(!drawingArea||!drawVertices.length)return;drawPointer=snappedPointer(event);refreshDraftMap();}
function beginDrawingArea(){
 if(!state.data||!state.mapLoaded){areaMessage('Load the planning grid and map before drawing.');return;}
 cancelFactorHover();activeWorkspace('areas');drawMode=$('drawMode').value;
 drawingArea=true;drawVertices=[];drawPointer=null;
 if(map&&state.mapLoaded){map.doubleClickZoom.disable();map.getCanvas().style.cursor='crosshair';}
 $('drawArea').hidden=true;$('drawMode').disabled=true;$('finishArea').hidden=drawMode!=='polygon';$('finishArea').disabled=true;$('cancelArea').hidden=false;
 $('areaDrawHint').textContent=drawMode==='polygon'?'Click three or more corners. Shift snaps to horizontal/vertical; Enter or double-click finishes.':'Click the first corner, then the opposite corner to finish.';
 refreshDraftMap();
}
function endDrawingMode(){
 drawingArea=false;drawVertices=[];drawPointer=null;
 $('drawArea').hidden=false;$('drawMode').disabled=false;$('finishArea').hidden=true;$('cancelArea').hidden=true;
 $('areaDrawHint').textContent='Choose Polygon, Rectangle or Square. Hold Shift for right angles in Polygon mode.';
 if(map&&state.mapLoaded){map.doubleClickZoom.enable();map.getCanvas().style.cursor='';}
 refreshDraftMap();
}
function finishDrawingArea(){
 if(!drawingArea)return;
 if(drawMode==='polygon'&&drawVertices.length<3){areaMessage('Place at least three corners before finishing.');return;}
 if(drawMode!=='polygon'&&!drawPointer){areaMessage('Place the opposite corner first.');return;}
 const ring=drawingRing(drawPointer);
 if(!ring||!isSimplePolygon(ring.slice(0,-1))){areaMessage('This area crosses itself. Undo or redraw a simple outline.');return;}
 const geom={type:'Polygon',coordinates:[ring]};
 const box=bboxOfGeometry(geom);
 if(!box||(box[2]-box[0])*(box[3]-box[1])<1e-13){areaMessage('The area is too small to analyze. Zoom in and draw larger.');return;}
 const area={id:'area-'+(++areaIdCounter),name:'Area '+areaIdCounter,geometry:geom,result:null};
 drawnAreas.push(area);selectedAreaId=area.id;
 endDrawingMode();refreshAreaMap();renderAreaResults();recalculateAreas();
}
function clearAllAreas(silent=false){
 ++areaRunRevision;drawnAreas.length=0;selectedAreaId=null;areaIdCounter=0;
 if(drawingArea)endDrawingMode();
 if(state.mapLoaded)refreshAreaMap();
 renderAreaResults();if(!silent)areaMessage('All drawn areas cleared.');
}
function deleteArea(id){
 const index=drawnAreas.findIndex(a=>a.id===id);if(index<0)return;
 drawnAreas.splice(index,1);if(selectedAreaId===id)selectedAreaId=drawnAreas[0]?.id||null;
 ++areaRunRevision;refreshAreaMap();renderAreaResults();
 if(drawnAreas.length)recalculateAreas();else areaMessage('Draw a polygon to calculate area scores.');
}
function zoomToArea(id){
 const area=drawnAreas.find(x=>x.id===id);if(!area)return;
 selectedAreaId=id;refreshAreaMap();renderAreaResults();
 const box=bboxOfGeometry(area.geometry);
 if(box && state.mapLoaded)map.fitBounds([[box[0],box[1]],[box[2],box[3]]],{padding:65,duration:450,maxZoom:17});
}
function areaDeltaLabel(value,benchmark){
 if(!isFiniteNumber(value)||!isFiniteNumber(benchmark))return {label:'Δ —',difference:null,description:'Default comparison unavailable'};
 const difference=Number(value)-Number(benchmark);
 // Display a true signed difference in score points (not percent). Avoid
 // a misleading -0.00 from floating-point drift.
 const rounded=Math.abs(difference)<0.005?0:difference;
 return {label:rounded>0?`+${rounded.toFixed(2)}`:rounded<0?`−${Math.abs(rounded).toFixed(2)}`:'±0.00',
   difference,description:`Default ${Number(benchmark).toFixed(2)}; current ${Number(value).toFixed(2)}`};
}
function areaScoreHTML(value,mode,benchmark){
 const hex=relativeScoreColor(value,mode);const style=hex?`background:${hex};color:${scoreTextColor(hex)};`:'background:#eef2f2;color:#87969c;';
 const delta=areaDeltaLabel(value,benchmark);
 const title=`${mode} score, colour relative to current scenario range. ${delta.description}. Change = current area-weighted mean minus original spreadsheet-default area-weighted mean.`;
 return `<div class="area-score-chip" style="${style}" title="${escapeHTML(title)}"><small>${mode==='baseline'?'Baseline':mode==='gap'?'Gap':'Combined'}</small><strong>${prettyScore(value)}</strong><span class="area-score-delta" aria-label="Change from default: ${escapeHTML(delta.label)}">${escapeHTML(delta.label)} <em>vs default</em></span></div>`;
}
function renderAreaResults(){
 $('areaCount').textContent=`${drawnAreas.length} polygon${drawnAreas.length===1?'':'s'}`;
 $('areaTabCount').textContent=drawnAreas.length?String(drawnAreas.length):'';
 for(const id of ['exportAreasCSV','exportAreasGeoJSON','clearAreas'])$(id).disabled=!drawnAreas.length;
 const list=$('areasList');list.replaceChildren();
 if(!drawnAreas.length){list.innerHTML='<div class="area-empty">No areas drawn yet. The map stays interactive while you edit scenario weights.</div>';return;}
 for(const area of drawnAreas){
  const card=document.createElement('article');card.className='area-result-card'+(area.id===selectedAreaId?' selected':'');
  const result=area.result;
  const km2=multiPolygonAreaM2(geometryAsMultiPolygon(area.geometry),(bboxOfGeometry(area.geometry)[1]+bboxOfGeometry(area.geometry)[3])/2)/1e6;
  card.innerHTML=`<div class="area-result-header"><input class="area-name-input" aria-label="Name of ${escapeHTML(area.name)}" value="${escapeHTML(area.name)}" maxlength="80"><button class="tiny area-zoom" title="Zoom to polygon">Zoom</button><button class="tiny area-delete" title="Remove polygon">✕</button></div>
  <div class="area-result-figures">${['baseline','gap','combined'].map(mode=>areaScoreHTML(result?.scores[mode]??null,mode,result?.defaults?.[mode]??null)).join('')}</div>
  <div class="area-result-meta">${km2<1?`${(km2*100).toFixed(2)} ha`:`${km2.toFixed(2)} km²`} drawn · ${result?`${(result.overlapM2/10000).toFixed(2)} ha in analysis grid · ${result.touched.toLocaleString()} overlapping cells`:'Calculating area averages…'}</div>
  ${result?`<div class="area-coverage">Valid scored area: Baseline ${result.coverage.baseline.toFixed(0)}% · Gap ${result.coverage.gap.toFixed(0)}% · Combined ${result.coverage.combined.toFixed(0)}%</div>`:''}`;
  card.querySelector('.area-name-input').addEventListener('change',e=>{area.name=e.target.value.trim().slice(0,80)||area.name;refreshAreaMap();});
  card.querySelector('.area-zoom').addEventListener('click',()=>zoomToArea(area.id));
  card.querySelector('.area-delete').addEventListener('click',()=>deleteArea(area.id));
  list.append(card);
 }
}
function recalculateAreas(){
 ++areaRunRevision;
 const run=areaRunRevision;
 if(!drawnAreas.length||!state.data||!scoresCalculated)return;
 if(!window.polygonClipping?.intersection){areaMessage('Area analysis requires the polygon-clipping library. Check internet access and reload.');return;}
 for(const area of drawnAreas)area.result=null;
 refreshAreaMap();renderAreaResults();
 const features=state.data.features;const total=drawnAreas.length;let ai=0,i=0,acc=null;
 const started=performance.now();
 areaMessage(`Calculating ${total} polygon${total===1?'':'s'}…`,true);
 function chunk(){
  if(run!==areaRunRevision)return;
  const deadline=performance.now()+12;
  try{
   while(ai<total && performance.now()<deadline){
    const area=drawnAreas[ai];if(!acc)acc=newAreaAccumulator(area.geometry);
    while(i<features.length && performance.now()<deadline)addCellToAccumulator(acc,features[i++],window.polygonClipping);
    if(i>=features.length){area.result=finishAreaAccumulator(acc);i=0;acc=null;ai++;refreshAreaMap();renderAreaResults();}
   }
  }catch(error){areaMessage(`Area calculation error: ${error.message}`);console.error(error);return;}
  if(run!==areaRunRevision)return;
  if(ai<total){areaMessage(`Measuring overlap… ${Math.floor(100*(ai+i/Math.max(1,features.length))/total)}%`,true);requestAnimationFrame(chunk);}
  else{const seconds=((performance.now()-started)/1000).toFixed(1);areaMessage(`✓ ${total} area${total===1?'':'s'} updated · ${seconds} s`);}
 }
 requestAnimationFrame(chunk);
}
function exportAreaSummary(){
 if(!drawnAreas.length)return;
 const rows=[['Area','Baseline','Gap','Combined','Drawn area (ha)','Grid overlap area (ha)','Overlapping cells','Baseline valid area %','Gap valid area %','Combined valid area %','Default Baseline','Default Gap','Default Combined','Baseline change vs default','Gap change vs default','Combined change vs default']];
 for(const a of drawnAreas){const b=bboxOfGeometry(a.geometry);const full=multiPolygonAreaM2(geometryAsMultiPolygon(a.geometry),(b[1]+b[3])/2);
  const r=a.result;rows.push([a.name,r?.scores.baseline??'',r?.scores.gap??'',r?.scores.combined??'',full/1e4,r?r.overlapM2/1e4:'',r?.touched??'',r?.coverage.baseline??'',r?.coverage.gap??'',r?.coverage.combined??'',r?.defaults?.baseline??'',r?.defaults?.gap??'',r?.defaults?.combined??'',r?.deltas?.baseline??'',r?.deltas?.gap??'',r?.deltas?.combined??'']);}
 const quoted=rows.map(row=>row.map(x=>'"'+String(x??'').replace(/"/g,'""')+'"').join(',')).join('\r\n');
 downloadBlob(new Blob([quoted],{type:'text/csv;charset=utf-8'}),'planning-opportunity-area-scores.csv');
}
function exportAreaPolygons(){
 if(!drawnAreas.length)return;
 const fc={type:'FeatureCollection',features:drawnAreas.map(a=>({type:'Feature',properties:{name:a.name,
  baseline:a.result?.scores.baseline??null,gap:a.result?.scores.gap??null,combined:a.result?.scores.combined??null,
  default_baseline:a.result?.defaults?.baseline??null,default_gap:a.result?.defaults?.gap??null,default_combined:a.result?.defaults?.combined??null,
  baseline_delta:a.result?.deltas?.baseline??null,gap_delta:a.result?.deltas?.gap??null,combined_delta:a.result?.deltas?.combined??null,
  valid_baseline_pct:a.result?.coverage.baseline??null,valid_gap_pct:a.result?.coverage.gap??null,
  valid_combined_pct:a.result?.coverage.combined??null,grid_overlap_m2:a.result?.overlapM2??null,
  grid_cells:a.result?.touched??null},geometry:a.geometry}))};
 downloadBlob(new Blob([JSON.stringify(fc,null,2)],{type:'application/geo+json'}),'planning-opportunity-areas.geojson');
}
function initializeAreaControls(){
 $('workspaceScenarioTab').addEventListener('click',()=>activeWorkspace('scenario'));
 $('workspaceAreasTab').addEventListener('click',()=>activeWorkspace('areas'));
 for(const input of document.querySelectorAll('input[name=areaGridView]')){
  input.addEventListener('change',()=>{
   if(!input.checked)return;
   state.areaView=input.value;
   if(state.workspace==='areas')setMapView(state.areaView);
  });
 }
 $('drawArea').addEventListener('click',beginDrawingArea);
 $('drawMode').addEventListener('change',()=>{drawMode=$('drawMode').value;});
 $('finishArea').addEventListener('click',finishDrawingArea);
 $('cancelArea').addEventListener('click',endDrawingMode);
 $('clearAreas').addEventListener('click',()=>clearAllAreas());
 $('exportAreasCSV').addEventListener('click',exportAreaSummary);
 $('exportAreasGeoJSON').addEventListener('click',exportAreaPolygons);
 window.addEventListener('keydown',event=>{
  if(!drawingArea||['INPUT','TEXTAREA'].includes(event.target?.tagName))return;
  if(event.key==='Escape'){event.preventDefault();endDrawingMode();}
  if((event.key==='Backspace'||event.key==='Delete')&&drawMode==='polygon'){event.preventDefault();drawVertices.pop();refreshDraftMap();$('finishArea').disabled=drawVertices.length<3;}
  if(event.key==='Enter' && drawMode==='polygon' && drawVertices.length>=3){event.preventDefault();finishDrawingArea();}
 });
 renderAreaResults();
}

function setHandlers(){
 $('demoBtn').addEventListener('click',()=>fetchData(true).catch(e=>setError(e.message)));
 $('retryBtn').addEventListener('click',()=>fetchData(false).catch(e=>setError(e.message)));
 $('resetView').addEventListener('click',()=>updateMap(true));
 $('basemapChoice').addEventListener('change',setBasemapVisibility);
 for(const tab of ['baseline','gap','combined']){
  const name=tab[0].toUpperCase()+tab.slice(1);$('tab'+name).addEventListener('click',()=>activateTab(tab));
  $('tab'+name).addEventListener('keydown',e=>{
   if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;
   e.preventDefault();const keys=['baseline','gap','combined'],i=keys.indexOf(tab);
   const next=e.key==='Home'?0:e.key==='End'?2:(i+(e.key==='ArrowRight'?1:-1)+3)%3;
   activateTab(keys[next]);$('tab'+keys[next][0].toUpperCase()+keys[next].slice(1)).focus();
  });
 }
 $('resetBaseline').addEventListener('click',()=>resetStage('Baseline'));
 $('resetGap').addEventListener('click',()=>resetStage('Gap'));
 $('resetCombined').addEventListener('click',()=>{$('split').value=50;state.settings.baselineShare=50;updateSplit();scheduleUpdate('blend');});
 $('moveNeeds').addEventListener('change',updateRoutes);$('moveCommunity').addEventListener('change',updateRoutes);
 $('split').addEventListener('input',()=>{state.settings.baselineShare=Number($('split').value);updateSplit();scheduleUpdate('blend');});
 $('clearCell').addEventListener('click',()=>{state.selectedId=null;updateSelection();});
 $('resetWeights').addEventListener('click',()=>{for(const f of state.meta?.factors??[])state.settings.weights[f.id]=state.defaults[f.id]??0;
  state.settings.moveNeeds=false;state.settings.moveCommunity=false;state.settings.baselineShare=50;
  $('moveNeeds').checked=false;$('moveCommunity').checked=false;$('split').value=50;updateSplit();buildWeights();scheduleUpdate('full');});
 $('copyScenario').addEventListener('click',async()=>{
  if(!state.data)return;
  const url=location.href.split('#')[0]+'#scenario='+encodeURIComponent(JSON.stringify(state.settings));
  try{await navigator.clipboard.writeText(url);$('copyScenario').textContent='Copied!';setTimeout(()=>$('copyScenario').textContent='Copy scenario link',1600);}
  catch(e){window.prompt('Copy this scenario URL',url);}
 });
 $('exportScenario').addEventListener('click',exportCSV);
 initializeAreaControls();
}
setHandlers();createMap();
import('./opendata.mjs').then(({initOpenDataWidget})=>initOpenDataWidget({getMap:()=>map,getMapLoaded:()=>state.mapLoaded,getLabelAnchor:()=>nativeLabelAnchor})).catch(e=>console.warn('Vancouver Open Data panel unavailable',e));
fetchData(false).catch(e=>{console.info('Model data not yet exported:',e.message);});
