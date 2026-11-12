// Drawing geometry in WGS84 coordinates.  Shift snapping follows map screen axes;
// square construction uses Web Mercator x/y metres at the selected location.
// The source palette in model.mjs also drives this map UI.
export { BIVARIATE as BIVARIATE4 } from './model.mjs';
const R=6378137, MAX_LAT=85.05112878;
const toRad=x=>x*Math.PI/180, toDeg=x=>x*180/Math.PI;
function mercator(ll){const lat=Math.max(-MAX_LAT,Math.min(MAX_LAT,ll[1]));return [R*toRad(ll[0]),R*Math.log(Math.tan(Math.PI/4+toRad(lat)/2))];}
function lonLat(xy){return [toDeg(xy[0]/R),toDeg(2*Math.atan(Math.exp(xy[1]/R))-Math.PI/2)];}
export function rectangleRing(a,b,square=false){
 const [x0,y0]=mercator(a);let [x1,y1]=mercator(b);
 if(square){const side=Math.max(Math.abs(x1-x0),Math.abs(y1-y0));
  x1=x0+(x1>=x0?side:-side);y1=y0+(y1>=y0?side:-side);}
 // Coordinates go around the perimeter; never cross diagonally.
 return [[x0,y0],[x1,y0],[x1,y1],[x0,y1],[x0,y0]].map(lonLat);
}
export function orthogonalCoordinate(last,point,project,unproject){
 if(!last)return point;
 const a=project(last),b=project(point);
 return unproject(Math.abs(b.x-a.x)>=Math.abs(b.y-a.y)?{x:b.x,y:a.y}:{x:a.x,y:b.y});
}
