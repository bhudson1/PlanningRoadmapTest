// Pure, dependency-free scoring shared by UI and verification tests.
export const BIVARIATE = [
  '#e3e8e7','#a6d9c7','#4ca993',
  '#d8b2c4','#a4b7b4','#548e90',
  '#b9749e','#835a94','#28536f'
];
export const SCORE_STOPS = [
  [1,'#cb4c47'],[2,'#edb05b'],[3,'#f1e69c'],[4,'#99ce83'],[5,'#26885c']
];
export function currentStage(factor, settings){
  if(factor.movable && ((factor.category === 'Daily Needs' && settings.moveNeeds) ||
       (factor.category === 'Community Spaces' && settings.moveCommunity) ||
       (/community centre/i.test(factor.name) && settings.moveCommunity))) return 'Gap';
  return factor.stage;
}
export function adjustedFactorScore(properties, factor, settings){
  const raw=properties[factor.id];
  if(raw === null || raw === undefined || raw === '') return null;
  const score=Number(raw);
  if(!Number.isFinite(score) || score < 1 || score > 5) return null;
  return factor.stage==='Baseline' && currentStage(factor,settings)==='Gap' ? 6-score : score;
}
export function stageWeightTotals(factors,settings){
  const totals={Baseline:0,Gap:0};
  for(const f of factors) totals[currentStage(f,settings)] += Math.max(0,Number(settings.weights[f.id] ?? 5));
  return totals;
}
export function computeScores(properties,factors,settings){
  const num={Baseline:0,Gap:0}, den={Baseline:0,Gap:0};
  for(const factor of factors){
    const w=Math.max(0,Number(settings.weights[factor.id] ?? 5));
    if(!w) continue;
    const s=adjustedFactorScore(properties,factor,settings);
    if(s===null) continue;
    const st=currentStage(factor,settings);
    num[st]+=w*s;
    den[st]+=w;
  }
  const baseline=den.Baseline>0?num.Baseline/den.Baseline:null;
  const gap=den.Gap>0?num.Gap/den.Gap:null;
  const blend=Math.min(1,Math.max(0,Number(settings.baselineShare??50)/100));
  // No false combination from a missing stage. Exception: 0% / 100% selected.
  const combined = blend===1?baseline:blend===0?gap:
    (baseline !== null && gap !== null ? baseline*blend+gap*(1-blend):null);
  const cat=x=>x===null?-1:Math.min(2,Math.max(0,Math.floor((x-1)/ (4/3))));
  const a=cat(baseline),b=cat(gap);
  return {baseline,gap,combined,biv:a<0||b<0?-1:b*3+a};
}
export function prettyScore(score){return score===null || !Number.isFinite(score)?'—':score.toFixed(2)}
export function ratioText(fraction){
  if(fraction===null || fraction===undefined || fraction==='') return '—';
  const n=Number(fraction);
  return Number.isFinite(n) && n>=0 && n<=1.000001?`${(100*n).toFixed(1)}%`:'—';
}
export function summarize(features){
  let n=0,b=0,g=0,c=0,bn=0,gn=0,cn=0;
  for(const f of features){const p=f.properties;
    if(p.__base!=null){b+=p.__base;bn++;} if(p.__gap!=null){g+=p.__gap;gn++;}
    if(p.__combined!=null){c+=p.__combined;cn++;}n++;
  }
  return {cells:n,baseline:bn?b/bn:null,gap:gn?g/gn:null,combined:cn?c/cn:null};
}
