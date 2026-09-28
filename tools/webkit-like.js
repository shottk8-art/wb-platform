/* getScreenCTM «как в Safari»: положение svg на экране берётся с учётом
   CSS-трансформаций предков, а сам поворот и масштаб предков — нет
   (WebKit bug 209220, MDN browser-compat-data #6315). */
(function(){
  var real = SVGGraphicsElement.prototype.getScreenCTM;
  SVGSVGElement.prototype.getScreenCTM = function(){
    var m = real.call(this); if (!m) return m;
    var vb = this.viewBox && this.viewBox.baseVal;
    var vx = vb ? vb.x : 0, vy = vb ? vb.y : 0;
    var o = new DOMPoint(vx, vy).matrixTransform(m);   /* где на экране угол рамки svg */
    var s = Math.hypot(m.a, m.b);                      /* масштаб viewBox, без поворота */
    var r = this.createSVGMatrix();                    /* игра ждёт именно SVGMatrix */
    r.a = s; r.b = 0; r.c = 0; r.d = s; r.e = o.x - vx * s; r.f = o.y - vy * s;
    return r;
  };
})();
