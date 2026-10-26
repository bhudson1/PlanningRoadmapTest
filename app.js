import {BIVARIATE,SCORE_STOPS,currentStage,adjustedFactorScore,computeScores,prettyScore,ratioText,stageWeightTotals,summarize} from './model.mjs';
const $=(id)=>document.getElementById(id);
const escapeHTML=s=>String(s??'').replace(/[&<>"']/g, x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[x]));
const isFiniteNumber=x=>x!==null&&x!==undefined&&x!==''&&Number.isFinite(Number(x));
const state={data:null,meta:null,selectedId:null,mode:'combined',mapLoaded:false,demo:false,
  settings:{weights:{},moveNeeds:false,moveCommunity:false,baselineShare:50}};
// CARTO Positron light-gray map: muted streets underneath and readable place labels on top.
// This is a simple raster basemap and requires no API key.
const style={version:8,sources:{
  gray:{type:'raster',tiles:['https://basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}.png'],tileSize:256,
    attribution:'© OpenStreetMap contributors · © CARTO'},
  labels:{type:'raster',tiles:['https://basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}.png'],tileSize:256,
    attribution:'© OpenStreetMap contributors · © CARTO'}
},layers:[{id:'gray-basemap',type:'raster',source:'gray',paint:{'raster-opacity':1}}]};
let map;
let mappedDataset=null;
const lowToHigh=['#cb4c47','#edb05b','#f1e69c','#99ce83','#26885c'];
// MapLibre evaluates weights as a paint expression. The polygons and their
// attributes are uploaded ONCE; adjusting weights never retransmits a 100m
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
function fillExpression(mode){
 if(!state.meta)return '#dce3e1';
 if(mode==='bivariate'){
   const bucket=(v)=>['case',['<',v,2.333333333],0,['<',v,3.666666667],1,2];
   return ['let','b',stageExpression('Baseline'),'g',stageExpression('Gap'),
     ['case',['any',['<',['var','b'],1],['<',['var','g'],1]],'#dce3e1',
      ['match',['+',['*',3,bucket(['var','g'])],bucket(['var','b'])],
        ...BIVARIATE.flatMap((hex,i)=>[i,hex]),'#dce3e1']]];
 }
 return ['let','v',mapScoreExpr(mode),['case',['<',['var','v'],1],'#dce3e1',
  ['interpolate',['linear'],['var','v'],...SCORE_STOPS.flatMap(([value,color])=>[value,color])]]];
}
function createMap(){
  if(!window.maplibregl){$('loading').innerHTML='<h2>Map library unavailable</h2><p>Connect to the internet to load the MapLibre library, or vendor it for offline use.</p>';return;}
  map = new maplibregl.Map({container:'map',style,center:[-123.12,49.25],zoom:11.5,
    attributionControl:false,pitch:0,maxPitch:45});
  map.addControl(new maplibregl.NavigationControl({showCompass:false}),'bottom-right');
  map.addControl(new maplibregl.AttributionControl({compact:true}),'bottom-right');
  map.on('load',()=>{
    state.mapLoaded=true;
    map.addSource('cells',{type:'geojson',data:{type:'FeatureCollection',features:[]},generateId:false});
    map.addLayer({id:'scores',type:'fill',source:'cells',paint:{'fill-color':fillExpression(state.mode),'fill-opacity':.77}});
    map.addLayer({id:'boundaries',type:'line',source:'cells',minzoom:12,paint:{'line-color':'#304a52','line-opacity':.26,'line-width':.4}});
    map.addLayer({id:'gray-place-labels',type:'raster',source:'labels',paint:{'raster-opacity':.92}});
    map.addLayer({id:'selection',type:'line',source:'cells',paint:{'line-color':'#102e3d','line-width':2.8,'line-opacity':1},filter:['==',['get','GRID_ID'],'__none__']});
    map.on('click','scores',e=>{if(e.features?.length){state.selectedId=e.features[0].properties.GRID_ID;updateSelection();}});
    map.on('mouseenter','scores',()=>map.getCanvas().style.cursor='pointer');
    map.on('mouseleave','scores',()=>map.getCanvas().style.cursor='');
    if(state.data)updateMap(true);
  });
}
function makeBounds(fc){const bounds=new maplibregl.LngLatBounds();let found=false;
 function walk(arr){if(typeof arr?.[0]==='number'){bounds.extend(arr);found=true;}else if(Array.isArray(arr)){for(const a of arr)walk(a);}}
 for(const f of fc.features)walk(f.geometry.coordinates);
 return found?bounds:null;
}
let updatePending=false;
function scheduleUpdate(){
 if(updatePending)return;
 updatePending=true;
 requestAnimationFrame(()=>{updatePending=false;recompute();});
}
function recompute(){
 if(!state.data || !state.meta)return;
 const factors=state.meta.factors;const settings=state.settings;
 for(const feature of state.data.features){
   const p=feature.properties;const result=computeScores(p,factors,settings);
   p.__base=result.baseline;p.__gap=result.gap;p.__combined=result.combined;p.__biv=result.biv;
 }
 updateMap(false);
 updateSelection();
 updateWeightShares();
}
let throttleHandle=0;
function updateMap(zoom=false){
 if(!state.data || !state.mapLoaded)return;
 clearTimeout(throttleHandle);
 throttleHandle=setTimeout(()=>{
  const source=map.getSource('cells');
  if(source && mappedDataset!==state.data){source.setData(state.data);mappedDataset=state.data;}
  map.setPaintProperty('scores','fill-color',fillExpression(state.mode));
  if(zoom){const bounds=makeBounds(state.data);if(bounds)map.fitBounds(bounds,{padding:65,duration:650,maxZoom:14});}
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
  if(isFiniteNumber(p.PIPE_DWELLINGS))lines.push(`<p><b>Proposed dwelling units in source DA: ${Number(p.PIPE_DWELLINGS).toLocaleString(undefined,{maximumFractionDigits:0})}</b><br>Ratios are based on proposed dwelling units at the time of data collection in the dissemination area. This is not the number of homes within this 100 m cell.</p>`);
  if(lines.length===0)lines.push('<p>Housing share source fields are not available for this cell.</p>');
  el.innerHTML=`<div class="score-comparison"><div><small>Baseline</small><strong>${prettyScore(p.__base)}</strong></div><div><small>Gap</small><strong>${prettyScore(p.__gap)}</strong></div><div><small>Combined</small><strong>${prettyScore(p.__combined)}</strong></div></div><details class="housing-details" open><summary>Housing composition & source context</summary>${lines.join('')}<p><small>Tenure shares overlap and do not necessarily total 100%.</small></p></details>`;
 }
 for(const f of state.meta.factors){
  const badge=$('score_'+f.id);if(!badge)continue;
  const value=selected?adjustedFactorScore(p,f,state.settings):null;
  badge.textContent=prettyScore(value);
  badge.classList.toggle('missing',value===null);
  const native=$('native_'+f.id);
  if(native){
   const orig=selected&&p['V'+f.id.substring(1)];
   if(selected && isFiniteNumber(orig)){
     let display=Number(orig).toLocaleString(undefined,{maximumFractionDigits:2});
     const lookup=f.native_codes || null;
     if(lookup)display=lookup[String(Math.round(orig))] || display;
     native.textContent='Source: '+display;
     native.title=f.description||'Original source value summarized to 100 m';
   }else {native.textContent='';native.title='Original source value not available';}
  }
 }
}
function addFactorRows(holder,stage){
 const factors=state.meta.factors.filter(f=>currentStage(f,state.settings)===stage);
 const categories=[...new Set(factors.map(f=>f.category))];
 for(const category of categories){
   const heading=document.createElement('div');heading.className='category-name';heading.textContent=category;
   holder.append(heading);
   for(const f of factors.filter(f=>f.category===category)){
     const row=document.createElement('div');row.className='factor-row';
     const label=document.createElement('div');label.className='factor-title';
     const labelName=document.createElement('div');labelName.textContent=f.name;label.append(labelName);
     const raw=document.createElement('div');raw.id='native_'+f.id;raw.className='native-text';label.append(raw);
     if(f.description)label.title=f.description;
     const slider=document.createElement('div');slider.className='factor-slider';
     const input=document.createElement('input');input.type='range';input.min=0;input.max=10;input.step=.5;
     input.value=state.settings.weights[f.id]??5;input.setAttribute('aria-label','Relative weight for '+f.name);
     const out=document.createElement('output');out.id='val_'+f.id;out.textContent=String(input.value);
     input.addEventListener('input',()=>{
       state.settings.weights[f.id]=Number(input.value);out.textContent=String(input.value);scheduleUpdate();
     });slider.append(input,out);
     const pct=document.createElement('div');pct.className='weight-label';
     pct.innerHTML=`<span class="factor-percent" id="pct_${f.id}">—</span><span class="factor-value missing" id="score_${f.id}">—</span>`;
     row.append(label,slider,pct);holder.append(row);
   }
 }
 return factors.length;
}
function buildWeights(){
 if(!state.meta)return;
 const base=$('baselineFactorList'),gap=$('gapFactorList');base.replaceChildren();gap.replaceChildren();
 const bn=addFactorRows(base,'Baseline'),gn=addFactorRows(gap,'Gap');
 $('gapMovementNote').hidden=gn<=state.meta.factors.filter(f=>f.stage==='Gap').length;
 $('tabBaseline').querySelector('small').textContent=`${bn} factors`;
 $('tabGap').querySelector('small').textContent=`${gn} factors`;
 updateWeightShares();
}
function updateWeightShares(){
 if(!state.meta)return;
 const totals=stageWeightTotals(state.meta.factors,state.settings);
 for(const f of state.meta.factors){const el=$('pct_'+f.id);if(el){
  const total=totals[currentStage(f,state.settings)];const raw=Math.max(0,Number(state.settings.weights[f.id]??5));
  el.textContent=total?`${(100*raw/total).toFixed(1)}%`:'0%';
 }}
}
function activateTab(next){
 if(!['gap','baseline','combined'].includes(next))return;
 state.mode=next;
 for(const tab of ['gap','baseline','combined']){
  const active=tab===next;const cap=tab[0].toUpperCase()+tab.slice(1);
  const button=$('tab'+cap),panel=$('panel'+cap);
  button.classList.toggle('active',active);button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1;
  panel.hidden=!active;
 }
 $('mapContext').textContent=next==='baseline'?'BASELINE SCORE':next==='gap'?'HOUSING GAP SCORE':'COMBINED SCORE';
 legend();
 if(state.mapLoaded)map.setPaintProperty('scores','fill-color',fillExpression(state.mode));
}
function legend(){
 const el=$('legend');el.hidden=!state.data;
 if(!state.data)return;
 if(state.mode==='bivariate'){
  el.innerHTML=`<h4>Baseline × Gap</h4><div class="bi-axis">Higher Gap ↑</div><div class="bi-grid">${[6,7,8,3,4,5,0,1,2].map(i=>`<span style="background:${BIVARIATE[i]}"></span>`).join('')}</div><div class="bi-axis">Baseline: lower → higher</div>`;
 }else{
  el.innerHTML=`<h4>${state.mode==='baseline'?'Baseline':state.mode==='gap'?'Gap':'Combined'} score</h4><div class="legend-gradient"></div><div class="legend-labels"><span>1 · Low</span><span>3</span><span>5 · High</span></div>`;
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
 state.demo=demo;state.meta=meta;state.data=geojson;state.selectedId=null;mappedDataset=null;
 const prior=loadScenarioFromHash();
 state.settings={weights:Object.fromEntries(meta.factors.map(f=>[f.id,5])),moveNeeds:false,moveCommunity:false,baselineShare:50};
 if(prior){for(const f of meta.factors)if(Number.isFinite(Number(prior.weights?.[f.id])))state.settings.weights[f.id]=Math.max(0,Math.min(10,Number(prior.weights[f.id])));
   state.settings.moveNeeds=!!prior.moveNeeds;state.settings.moveCommunity=!!prior.moveCommunity;
   state.settings.baselineShare=Math.min(100,Math.max(0,Number(prior.baselineShare??50)));}
 $('moveNeeds').checked=state.settings.moveNeeds;$('moveCommunity').checked=state.settings.moveCommunity;
 $('split').value=state.settings.baselineShare;updateSplit();
 $('loading').hidden=true;
 $('dataTag').textContent=demo?'SYNTHETIC DEMO':'EXPORT · '+(meta.cell_count||geojson.features.length).toLocaleString()+' cells';
 $('dataTag').style.background=demo?'#ffe8c9':'#e9f2f2';
 $('cellCount').textContent=`${geojson.features.length.toLocaleString()} cells`;
 $('dataNotes').textContent=`Export created ${meta.created_utc?new Date(meta.created_utc).toLocaleString():'unknown date'}. Housing shares are fractions (0–1), displayed as percentages. Original workbook targets are embedded in metadata. Scenario changes do not alter the underlying exported data.`;
 $('bottomNote').textContent=demo?'SYNTHETIC DEMO — not Vancouver planning results':'100 m fixed grid · Browser-side scoring · Zero GIS recomputation';
 buildWeights();recompute();activateTab('combined');updateMap(true);
}
function updateSplit(){const b=Number($('split').value);$('splitBase').textContent=b+'%';$('splitGap').textContent=(100-b)+'%';$('combinedFormula').textContent=`Combined = ${b}% Baseline + ${100-b}% Gap`;}
function loadScenarioFromHash(){try{if(location.hash.startsWith('#scenario='))return JSON.parse(decodeURIComponent(location.hash.slice(10)));}catch(e){}return null;}
function updateRoutes(){state.settings.moveNeeds=$('moveNeeds').checked;state.settings.moveCommunity=$('moveCommunity').checked;buildWeights();recompute();}
function setError(message){$('loading').hidden=false;$('loading').querySelector('h2').textContent='Load planning data';
 const p=$('loading').querySelector('p');if(p)p.innerHTML=`${escapeHTML(message)}. Export <code>grid.geojson</code> and <code>meta.json</code> from the ArcGIS tool into the site’s <code>data/</code> folder.`;}
function downloadBlob(blob,name){const a=document.createElement('a');const url=URL.createObjectURL(blob);a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function exportCSV(){if(!state.data)return;const rows=[['GRID_ID','BASELINE','GAP','COMBINED']];
 for(const f of state.data.features){const p=f.properties;rows.push([p.GRID_ID,p.__base??'',p.__gap??'',p.__combined??'']);}
 const text=rows.map(r=>r.join(',')).join('\n');downloadBlob(new Blob([text],{type:'text/csv'}),'planning-opportunity-scenario.csv');}
function resetStage(stage){
 if(!state.meta)return;
 for(const f of state.meta.factors)if(currentStage(f,state.settings)===stage)state.settings.weights[f.id]=5;
 buildWeights();recompute();
}
function setHandlers(){
 $('demoBtn').addEventListener('click',()=>fetchData(true).catch(e=>setError(e.message)));
 $('retryBtn').addEventListener('click',()=>fetchData(false).catch(e=>setError(e.message)));
 $('resetView').addEventListener('click',()=>updateMap(true));
 for(const tab of ['gap','baseline','combined']){
  const name=tab[0].toUpperCase()+tab.slice(1);$('tab'+name).addEventListener('click',()=>activateTab(tab));
  $('tab'+name).addEventListener('keydown',e=>{
   if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;
   e.preventDefault();const keys=['gap','baseline','combined'],i=keys.indexOf(tab);
   const next=e.key==='Home'?0:e.key==='End'?2:(i+(e.key==='ArrowRight'?1:-1)+3)%3;
   activateTab(keys[next]);$('tab'+keys[next][0].toUpperCase()+keys[next].slice(1)).focus();
  });
 }
 $('resetBaseline').addEventListener('click',()=>resetStage('Baseline'));
 $('resetGap').addEventListener('click',()=>resetStage('Gap'));
 $('resetCombined').addEventListener('click',()=>{$('split').value=50;state.settings.baselineShare=50;updateSplit();scheduleUpdate();});
 $('moveNeeds').addEventListener('change',updateRoutes);$('moveCommunity').addEventListener('change',updateRoutes);
 $('split').addEventListener('input',()=>{state.settings.baselineShare=Number($('split').value);updateSplit();scheduleUpdate();});
 $('clearCell').addEventListener('click',()=>{state.selectedId=null;updateSelection();});
 $('resetWeights').addEventListener('click',()=>{for(const f of state.meta?.factors??[])state.settings.weights[f.id]=5;
  state.settings.moveNeeds=false;state.settings.moveCommunity=false;state.settings.baselineShare=50;
  $('moveNeeds').checked=false;$('moveCommunity').checked=false;$('split').value=50;updateSplit();buildWeights();recompute();});
 $('copyScenario').addEventListener('click',async()=>{
  if(!state.data)return;
  const url=location.href.split('#')[0]+'#scenario='+encodeURIComponent(JSON.stringify(state.settings));
  try{await navigator.clipboard.writeText(url);$('copyScenario').textContent='Copied!';setTimeout(()=>$('copyScenario').textContent='Copy scenario link',1600);}
  catch(e){window.prompt('Copy this scenario URL',url);}
 });
 $('exportScenario').addEventListener('click',exportCSV);
}
setHandlers();createMap();fetchData(false).catch(e=>{console.info('Model data not yet exported:',e.message);});
