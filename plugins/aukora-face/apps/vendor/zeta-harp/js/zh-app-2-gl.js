/* ==========================================================================
   3D renderer — WebGL2, instanced phase trajectories h_n(u).
   ========================================================================== */

var GLR = (function () {
  var canvas = document.getElementById('gl');
  var gl = canvas.getContext('webgl2', { antialias: true, alpha: false });
  var ok = !!gl;
  if (!ok) { canvas.style.display = 'none'; }

  /* MEASURED (#151): there was no `webglcontextlost` listener. A lost context — a GPU reset, a
     driver update, a laptop switching graphics, a backgrounded tab reclaimed — leaves every `gl.*`
     call returning null or throwing, and `frame()` re-arms itself unconditionally at the bottom.
     So the loop threw once per frame, forever, for as long as the tab stayed open.

     THE FIX REUSES A PATH THIS FILE ALREADY HAS. `draw()` opens with `if (!ok) return;` — the
     branch taken when WebGL2 was never available at all. Losing the context is that same fact
     arriving later, so it takes the same branch, and the surrounding 2D panels, the HUD and the
     audio keep running exactly as they do on a machine with no WebGL2.

     `preventDefault()` is what makes a restore possible at all. It is called even though this
     renderer cannot yet take one: every GL object here is built inline at IIFE time and there is
     no re-runnable init to call, so `restored` says so plainly instead of flipping `ok` back and
     drawing with dead handles. Rebuilding on restore is a real change to the renderer's shape, and
     it is not the change this issue asked for. */
  var lostNote = null;
  canvas.addEventListener('webglcontextlost', function (e) {
    e.preventDefault();
    ok = false;
    canvas.style.display = 'none';
    if (!lostNote) {
      lostNote = document.createElement('div');
      lostNote.id = 'glLost';
      lostNote.setAttribute('role', 'status');
      lostNote.textContent = 'The 3D view lost its graphics context. Everything else here is still live — reload to bring it back.';
      (canvas.parentNode || document.body).appendChild(lostNote);
    }
    lostNote.hidden = false;
  }, false);
  canvas.addEventListener('webglcontextrestored', function () {
    /* The context is back, but this renderer's buffers, programs and VAOs died with the old one and
       are not rebuilt here. Saying so is more honest than a black canvas that looks like a bug. */
    if (lostNote) lostNote.textContent = 'Graphics came back. This view needs a reload to rebuild it.';
  }, false);

  var SEG = 176;
  var CAM = { yaw: 0.6, pitch: 0.12, dist: 51, distTarget: 51, vyaw: 0, vpitch: 0, fov: 62 * Math.PI / 180 };  /* zoomed out ~1.5x: the tunnel reads as a whole structure */
  var lyrFade = LYR;        /* the shared eased layer fades (chart + tunnel read the same values) */
  var rings = [];           /* {r, z, age, life, col} ignition / shockwave events */
  var timeSec = 0;

  function compile(vsSrc, fsSrc) {
    function sh(type, src) {
      var s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
        throw new Error('shader: ' + gl.getShaderInfoLog(s));
      return s;
    }
    var p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, vsSrc));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fsSrc));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS))
      throw new Error('link: ' + gl.getProgramInfoLog(p));
    return p;
  }

  var helixProg, lineProg, dustProg;
  var helixVAO, tmplBuf, instBuf, lineVAO, lineBuf, dustVAO, dustBuf;
  var instData = null, DUST_N = 2600;
  var lineScratch = new Float32Array(1 << 16);
  var lineCount = 0;

  if (ok) {
    helixProg = compile(
      '#version 300 es\n' +
      'precision highp float;\n' +
      'layout(location=0) in float aU;\n' +
      'layout(location=1) in vec4 iA;\n' +   /* a, phi0, omega, uBirth */
      'layout(location=2) in float iIdx;\n' +
      'uniform mat4 uVP; uniform float uHalfW,uThpp,uThppp,uZScale,uRScale,uSel,uNlive,uFadeM;\n' +
      'out vec4 vColor;\n' +
      'void main(){\n' +
      '  float u=(aU*2.0-1.0)*uHalfW;\n' +
      '  u=max(u,iA.w);\n' +
      '  float phi=iA.y+iA.z*u+0.5*uThpp*u*u+0.16666667*uThppp*u*u*u;\n' +
      '  float c=cos(phi),s=sin(phi);\n' +
      '  vec3 p=vec3(iA.x*c*uRScale,iA.x*s*uRScale,u*uZScale);\n' +
      '  gl_Position=uVP*vec4(p,1.0);\n' +
      '  float pos=smoothstep(-0.18,0.18,c);\n' +
      '  vec3 tint=mix(vec3(0.52,0.34,0.92),vec3(0.30,0.50,0.94),pos);\n' +
      '  float amp=clamp(iA.x*0.5,0.0,1.0);\n' +
      '  float bright=0.055+0.50*pow(amp,0.72);\n' +
      '  float endFade=1.0-smoothstep(0.72,1.0,abs(aU*2.0-1.0));\n' +
      '  float live=(iIdx<uNlive)?1.0:0.45;\n' +   /* terms not yet in the sum at t0: dimmed */
      '  float selB=(abs(iIdx-uSel)<0.5)?2.6:1.0;\n' +
      '  vColor=vec4(tint*bright*endFade*live*selB*uFadeM*(0.30+0.70*abs(c)),1.0);\n' +
      '}\n',
      '#version 300 es\nprecision highp float;\n' +
      'in vec4 vColor; out vec4 o;\nvoid main(){ o=vColor; }\n');

    lineProg = compile(
      '#version 300 es\nprecision highp float;\n' +
      'layout(location=0) in vec3 aP; layout(location=1) in vec4 aC;\n' +
      'uniform mat4 uVP; out vec4 vC;\n' +
      'void main(){ gl_Position=uVP*vec4(aP,1.0); vC=aC; }\n',
      '#version 300 es\nprecision highp float;\nin vec4 vC; out vec4 o;\nvoid main(){ o=vC; }\n');

    dustProg = compile(
      '#version 300 es\nprecision highp float;\n' +
      'layout(location=0) in vec4 aP;\n' +   /* xyz + seed */
      'uniform mat4 uVP; uniform float uTime; out float vA;\n' +
      'void main(){\n' +
      '  vec3 p=aP.xyz;\n' +
      '  p.x+=0.35*sin(uTime*0.11+aP.w*13.0);\n' +
      '  p.y+=0.35*cos(uTime*0.09+aP.w*7.0);\n' +
      '  p.z+=0.8*sin(uTime*0.05+aP.w*29.0);\n' +
      '  vec4 cp=uVP*vec4(p,1.0);\n' +
      '  gl_Position=cp;\n' +
      '  gl_PointSize=max(1.0,3.2/max(0.4,cp.w*0.06));\n' +
      '  vA=0.16*(0.4+0.6*sin(uTime*0.5+aP.w*47.0));\n' +
      '}\n',
      '#version 300 es\nprecision highp float;\nin float vA; out vec4 o;\n' +
      'void main(){ vec2 d=gl_PointCoord-0.5; float f=1.0-smoothstep(0.1,0.5,length(d));\n' +
      '  o=vec4(vec3(0.35,0.42,0.62)*vA*f,1.0); }\n');

    /* template: SEG+1 param values */
    tmplBuf = gl.createBuffer();
    var tmpl = new Float32Array(SEG + 1);
    for (var i = 0; i <= SEG; i++) tmpl[i] = i / SEG;
    gl.bindBuffer(gl.ARRAY_BUFFER, tmplBuf);
    gl.bufferData(gl.ARRAY_BUFFER, tmpl, gl.STATIC_DRAW);

    instBuf = gl.createBuffer();
    helixVAO = gl.createVertexArray();
    gl.bindVertexArray(helixVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, tmplBuf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 1, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 20, 0);
    gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 20, 16);
    gl.vertexAttribDivisor(2, 1);
    gl.bindVertexArray(null);

    lineBuf = gl.createBuffer();
    lineVAO = gl.createVertexArray();
    gl.bindVertexArray(lineVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, lineBuf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 28, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 28, 12);
    gl.bindVertexArray(null);

    dustBuf = gl.createBuffer();
    var dust = new Float32Array(DUST_N * 4);
    for (var d = 0; d < DUST_N; d++) {
      var rr = 2 + 22 * Math.pow(Math.random(), 0.7), th2 = Math.random() * Math.PI * 2;
      dust[d * 4] = rr * Math.cos(th2);
      dust[d * 4 + 1] = rr * Math.sin(th2);
      dust[d * 4 + 2] = (Math.random() * 2 - 1) * SCENE_HALF * 1.1;
      dust[d * 4 + 3] = Math.random();
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, dustBuf);
    gl.bufferData(gl.ARRAY_BUFFER, dust, gl.STATIC_DRAW);
    dustVAO = gl.createVertexArray();
    gl.bindVertexArray(dustVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, dustBuf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 16, 0);
    gl.bindVertexArray(null);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.disable(gl.DEPTH_TEST);
  }

  /* ---- matrices --------------------------------------------------------- */
  var VP = new Float32Array(16);
  function mat4Mul(o, a, b) {
    for (var r = 0; r < 4; r++) for (var c = 0; c < 4; c++) {
      var s = 0;
      for (var k = 0; k < 4; k++) s += a[k * 4 + c] * b[r * 4 + k];
      o[r * 4 + c] = s;
    }
  }
  function buildVP(aspect) {
    var f = 1 / Math.tan(CAM.fov / 2), near = 0.1, far = 400;
    var proj = [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, 2 * far * near / (near - far), 0];
    var cy = Math.cos(CAM.yaw), sy = Math.sin(CAM.yaw);
    var cp = Math.cos(CAM.pitch), sp = Math.sin(CAM.pitch);
    var ex = CAM.dist * cp * sy, ey = CAM.dist * sp, ez = CAM.dist * cp * cy;
    var zx = ex, zy = ey, zz = ez;
    var zl = Math.hypot(zx, zy, zz); zx /= zl; zy /= zl; zz /= zl;
    var xx = zy * 0 - zz * 1 * 0, xy2, xz;
    /* right = up x z, up = (0,1,0) w/ pole guard */
    xx = 1 * zz - 0 * zy; xy2 = 0 * zx - 0 * zz; xz = 0 * zy - 1 * zx;
    var xl = Math.hypot(xx, xy2, xz) || 1; xx /= xl; xy2 /= xl; xz /= xl;
    var ux = zy * xz - zz * xy2, uy = zz * xx - zx * xz, uz = zx * xy2 - zy * xx;
    var view = [xx, ux, zx, 0, xy2, uy, zy, 0, xz, uz, zz, 0,
      -(xx * ex + xy2 * ey + xz * ez), -(ux * ex + uy * ey + uz * ez), -(zx * ex + zy * ey + zz * ez), 1];
    mat4Mul(VP, proj, view);   /* VP = P * V (column-major storage) */
    return { ex: ex, ey: ey, ez: ez };
  }

  /* project scene point to CSS pixels; null if behind camera */
  function project(x, y, z) {
    var cx = VP[0] * x + VP[4] * y + VP[8] * z + VP[12];
    var cy2 = VP[1] * x + VP[5] * y + VP[9] * z + VP[13];
    var cw = VP[3] * x + VP[7] * y + VP[11] * z + VP[15];
    if (cw <= 0.01) return null;
    return [(cx / cw * 0.5 + 0.5) * canvas.clientWidth,
            (0.5 - cy2 / cw * 0.5) * canvas.clientHeight];
  }

  /* ---- dynamic line scratch --------------------------------------------- */
  function pushSeg(x1, y1, z1, x2, y2, z2, r, g, b, a) {
    if ((lineCount + 14) * 1 > lineScratch.length) return;
    var o = lineCount;
    lineScratch[o] = x1; lineScratch[o + 1] = y1; lineScratch[o + 2] = z1;
    lineScratch[o + 3] = r; lineScratch[o + 4] = g; lineScratch[o + 5] = b; lineScratch[o + 6] = a;
    lineScratch[o + 7] = x2; lineScratch[o + 8] = y2; lineScratch[o + 9] = z2;
    lineScratch[o + 10] = r; lineScratch[o + 11] = g; lineScratch[o + 12] = b; lineScratch[o + 13] = a;
    lineCount += 14;
  }
  function pushRing(r, z, cr, cg, cb, ca, segs) {
    var S = segs || 72;
    for (var i = 0; i < S; i++) {
      var a1 = i / S * Math.PI * 2, a2 = (i + 1) / S * Math.PI * 2;
      pushSeg(r * Math.cos(a1), r * Math.sin(a1), z, r * Math.cos(a2), r * Math.sin(a2), z, cr, cg, cb, ca);
    }
  }

  function spawnRing(r, z, kind) {
    rings.push({ r: r, z: z, age: 0, life: kind === 'cross' ? 1.6 : 2.2, kind: kind });
  }

  /* ---- frame ------------------------------------------------------------ */
  function draw(dt) {
    if (!ok) return;
    timeSec += dt;
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var w = Math.floor(canvas.clientWidth * dpr), h = Math.floor(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    gl.viewport(0, 0, w, h);
    gl.clearColor(0.016, 0.023, 0.043, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    /* camera inertia + eased zoom (the ZOOM slider drives distTarget; nothing
       snaps). PLAY pauses the camera as well as time: nothing here moves
       while ST.paused. */
    if (!ST.paused) {
      CAM.yaw += CAM.vyaw; CAM.pitch += CAM.vpitch;
      CAM.vyaw *= 0.92; CAM.vpitch *= 0.92;
      CAM.pitch = Math.max(-1.35, Math.min(1.35, CAM.pitch));
      if (!ST.opening) {
        CAM.dist += (CAM.distTarget - CAM.dist) * Math.min(1, dt * 3.2);
        if (Math.abs(CAM.distTarget - CAM.dist) < 0.02) CAM.dist = CAM.distTarget;
      }
    }
    buildVP(canvas.clientWidth / canvas.clientHeight);
    /* the shared layer fades (LYR) are ticked once per frame in frame() — the
       chart reads the same values, so both surfaces change together */

    var t0 = ST.t, hw = halfWindow(t0), zs = zScale(t0);
    var rsc = RSCALE, zsc = zs;

    /* dust */
    gl.useProgram(dustProg);
    gl.uniformMatrix4fv(gl.getUniformLocation(dustProg, 'uVP'), false, VP);
    gl.uniform1f(gl.getUniformLocation(dustProg, 'uTime'), timeSec);
    gl.bindVertexArray(dustVAO);
    gl.drawArrays(gl.POINTS, 0, DUST_N);

    /* helices — the strings of the main sum; the chart's M chip fades them here */
    var NR = TERMS.NR;
    if (NR > 0 && lyrFade.M > 0.02) {
      if (!instData || instData.length < NR * 5) instData = new Float32Array((NR + 64) * 5);
      for (var n = 0; n < NR; n++) {
        instData[n * 5] = TERMS.a[n];
        instData[n * 5 + 1] = TERMS.phi0[n];
        instData[n * 5 + 2] = TERMS.omega[n];
        instData[n * 5 + 3] = TERMS.born[n];
        instData[n * 5 + 4] = n;
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
      gl.bufferData(gl.ARRAY_BUFFER, instData.subarray(0, NR * 5), gl.DYNAMIC_DRAW);
      gl.useProgram(helixProg);
      gl.uniformMatrix4fv(gl.getUniformLocation(helixProg, 'uVP'), false, VP);
      gl.uniform1f(gl.getUniformLocation(helixProg, 'uHalfW'), hw);
      gl.uniform1f(gl.getUniformLocation(helixProg, 'uThpp'), ZH.thetaPP(t0));
      gl.uniform1f(gl.getUniformLocation(helixProg, 'uThppp'), ZH.thetaPPP(t0));
      gl.uniform1f(gl.getUniformLocation(helixProg, 'uZScale'), zsc);
      gl.uniform1f(gl.getUniformLocation(helixProg, 'uRScale'), rsc);
      gl.uniform1f(gl.getUniformLocation(helixProg, 'uSel'), ST.sel >= 1 ? ST.sel - 1 : -9);
      gl.uniform1f(gl.getUniformLocation(helixProg, 'uNlive'), TERMS.N - 0.5);
      gl.uniform1f(gl.getUniformLocation(helixProg, 'uFadeM'), lyrFade.M);
      gl.bindVertexArray(helixVAO);
      gl.drawArraysInstanced(gl.LINE_STRIP, 0, SEG + 1, NR);
    }

    /* dynamic lines: the gold resultant coil + slice + rings + real axis.
       The chart's Z chip fades the gold coil here (the golden thing in the
       tunnel appears/disappears live, eased). */
    lineCount = 0;
    if (RIB.valid && lyrFade.Z > 0.02) {
      var fz = lyrFade.Z;
      for (var k = 0; k < RIB_K - 1; k++) {
        var z1 = RIB.u[k] * zsc, z2 = RIB.u[k + 1] * zsc;
        pushSeg(RIB.x[k] * rsc, RIB.y[k] * rsc, z1,
                RIB.x[k + 1] * rsc, RIB.y[k + 1] * rsc, z2,
                0.89 * fz, 0.71 * fz, 0.35 * fz, 1);
        /* faint under-glow copy, slightly offset, for ribbon weight */
        pushSeg(RIB.x[k] * rsc, RIB.y[k] * rsc - 0.06, z1,
                RIB.x[k + 1] * rsc, RIB.y[k + 1] * rsc - 0.06, z2,
                0.30 * fz, 0.23 * fz, 0.10 * fz, 1);
      }
    }
    if (ST.frozen) {
      /* slice plane: real axis + per-term markers + projection drops + partial sums */
      var axExt = rsc * 2.6;
      pushSeg(-axExt, 0, 0, axExt, 0, 0, 0.28, 0.32, 0.42, 1);
      pushRing(rsc * 2, 0, 0.10, 0.12, 0.17, 1, 96);
      var run = 0;
      for (var m = 0; m < TERMS.N; m++) {
        var px = TERMS.a[m] * Math.cos(TERMS.phi0[m]) * rsc;
        var py = TERMS.a[m] * Math.sin(TERMS.phi0[m]) * rsc;
        var pos2 = TERMS.c[m] >= 0;
        var cr = pos2 ? 0.30 : 0.52, cg = pos2 ? 0.50 : 0.34, cb = pos2 ? 0.94 : 0.92;
        pushSeg(px, py, 0, px, 0, 0, cr * 0.35, cg * 0.35, cb * 0.35, 1);     /* projection drop */
        pushSeg(px, py, 0, px, py, 0.28, cr, cg, cb, 1);                       /* marker tick */
        var run2 = run + TERMS.c[m] * rsc;
        pushSeg(run, -0.5, 0, run2, -0.5, 0, 0.89, 0.71, 0.35, 0.8);           /* partial-sum walk */
        run = run2;
      }
      pushSeg(run, -1.1, 0, run, 0.1, 0, 0.95, 0.78, 0.40, 1);                 /* M(t) landing tick */
    }
    for (var q = rings.length - 1; q >= 0; q--) {
      var rg = rings[q]; rg.age += dt;
      if (rg.age > rg.life) { rings.splice(q, 1); continue; }
      var frac = rg.age / rg.life, fade = 1 - frac;
      if (rg.kind === 'cross') {
        pushRing(rg.r + frac * 26, rg.z, 0.89 * fade, 0.71 * fade, 0.35 * fade, 1, 96);
      } else {
        pushRing(rg.r * (1 + frac * 0.25), rg.z, 0.4 * fade, 0.55 * fade, 0.95 * fade, 1, 96);
        pushRing(rg.r * (1 + frac * 0.5), rg.z, 0.2 * fade, 0.3 * fade, 0.6 * fade, 1, 96);
      }
    }
    if (lineCount > 0) {
      gl.useProgram(lineProg);
      gl.uniformMatrix4fv(gl.getUniformLocation(lineProg, 'uVP'), false, VP);
      gl.bindVertexArray(lineVAO);
      gl.bindBuffer(gl.ARRAY_BUFFER, lineBuf);
      gl.bufferData(gl.ARRAY_BUFFER, lineScratch.subarray(0, lineCount), gl.DYNAMIC_DRAW);
      gl.drawArrays(gl.LINES, 0, lineCount / 7);
    }
    gl.bindVertexArray(null);
  }

  /* nearest term to a click at the frozen slice; returns n (1-based) or -1 */
  function pickTerm(cssX, cssY) {
    var best = -1, bestD = 16;
    var rsc = RSCALE;
    for (var m = 0; m < TERMS.N; m++) {
      var px = TERMS.a[m] * Math.cos(TERMS.phi0[m]) * rsc;
      var py = TERMS.a[m] * Math.sin(TERMS.phi0[m]) * rsc;
      var s = project(px, py, 0);
      if (!s) continue;
      var d = Math.hypot(s[0] - cssX, s[1] - cssY);
      if (d < bestD) { bestD = d; best = m + 1; }
    }
    return best;
  }

  return { ok: ok, CAM: CAM, draw: draw, spawnRing: spawnRing, pickTerm: pickTerm, canvas: canvas };
})();
