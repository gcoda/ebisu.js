(function(f){if(typeof exports==="object"&&typeof module!=="undefined"){module.exports=f()}else if(typeof define==="function"&&define.amd){define([],f)}else{var g;if(typeof window!=="undefined"){g=window}else if(typeof global!=="undefined"){g=global}else if(typeof self!=="undefined"){g=self}else{g=this}g.ebisu = f()}})(function(){var define,module,exports;return (function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
"use strict";
var gammaln = require('gamma').log;
const logsumexp = require('./logsumexp');
const exp = Math.exp;
const log = Math.log;

const GAMMALN_CACHE = new Map();
function gammalnCached(x) {
  let hit = GAMMALN_CACHE.get(x);
  if (hit) { return hit; }
  hit = gammaln(x);
  GAMMALN_CACHE.set(x, hit);
  return hit;
}
function betalnRatio(a1, a, b) { return gammaln(a1) - gammaln(a1 + b) + gammalnCached(a + b) - gammalnCached(a); }
function betaln(a, b) { return gammalnCached(a) + gammalnCached(b) - gammalnCached(a + b); }

function predictRecall(prior, tnow, exact = false) {
  const [alpha, beta, t] = prior;
  const dt = tnow / t;
  const ret = betalnRatio(alpha + dt, alpha, beta);
  return exact ? exp(ret) : ret;
}

function updateRecall(prior, result, tnow, rebalance = true, tback = undefined) {
  const [alpha, beta, t] = prior
  tback = tback || t
  const dt = tnow / t;
  const et = tnow / tback;
  let mean, sig2;
  if (result) {
    if (tback === t) {
      const proposed = [alpha + dt, beta, t];
      return rebalance ? _rebalance(prior, result, tnow, proposed) : proposed;
    }
    const logmean = betalnRatio(alpha + dt / et * (1 + et), alpha + dt, beta);
    const logm2 = betalnRatio(alpha + dt / et * (2 + et), alpha + dt, beta);
    mean = exp(logmean);
    sig2 = _subexp(logm2, 2 * logmean);
  } else {
    const logDenominator = _logsubexp(betaln(alpha, beta), betaln(alpha + dt, beta))
    mean = _subexp(betaln(alpha + dt / et, beta) - logDenominator,
                   betaln(alpha + dt / et * (et + 1), beta) - logDenominator)
    const m2 = _subexp(betaln(alpha + 2 * dt / et, beta) - logDenominator,
                       betaln(alpha + dt / et * (et + 2), beta) - logDenominator)
    if (m2 <= 0) { throw new Error('invalid second moment found'); }
    sig2 = m2 - mean ** 2
  }
  if (mean <= 0) { throw new Error('invalid mean found'); }
  if (sig2 <= 0) { throw new Error('invalid variance found'); }
  const [newAlpha, newBeta] = _meanVarToBeta(mean, sig2);
  const proposed = [newAlpha, newBeta, tback];
  return rebalance ? _rebalance(prior, result, tnow, proposed) : proposed;
}

function _rebalance(prior, result, tnow, proposed) {
  const [newAlpha, newBeta, _] = proposed;
  if (newAlpha > 2 * newBeta || newBeta > 2 * newAlpha) {
    const roughHalflife = modelToPercentileDecay(proposed, 0.5, true);
    return updateRecall(prior, result, tnow, false, roughHalflife);
  }
  return proposed;
}

function _logsubexp(a, b) { return logsumexp([a, b], [1, -1])[0]; }

function _subexp(x, y) {
  const maxval = Math.max(x, y)
  return exp(maxval) * (exp(x - maxval) - exp(y - maxval));
}

function _meanVarToBeta(mean, v) {
  var tmp = mean * (1 - mean) / v - 1;
  var alpha = mean * tmp
  var beta = (1 - mean) * tmp;
  return [alpha, beta];
}

function defaultModel(t, a = 4.0, b = a) { return [a, b, t]; }

function modelToPercentileDecay(model, percentile = 0.5, coarse = false, tolerance = 1e-4) {
  if (percentile < 0 || percentile > 1) { throw new Error('percentiles must be between (0, 1) exclusive'); }
  const [alpha, beta, t0] = model;
  const logBab = betaln(alpha, beta);
  const logPercentile = log(percentile);
  function f(lndelta) {
    const logMean = betaln(alpha + exp(lndelta), beta) - logBab;
    return logMean - logPercentile;
  }
  const bracket_width = coarse ? 1 : 6;
  let blow = -bracket_width / 2.0
  let bhigh = bracket_width / 2.0
  let flow = f(blow)
  let fhigh = f(bhigh)
  while (flow > 0 && fhigh > 0) {
    // Move the bracket up.
    blow = bhigh
    flow = fhigh
    bhigh += bracket_width
    fhigh = f(bhigh)
  }
  while (flow < 0 && fhigh < 0) {
    // Move the bracket down.
    bhigh = blow
    fhigh = flow
    blow -= bracket_width
    flow = f(blow)
  }

  if (!(flow > 0 && fhigh < 0)) { throw new Error('failed to bracket') }
  if (coarse) { return (exp(blow) + exp(bhigh)) / 2 * t0; }
  const fmin = require('minimize-golden-section-1d');
  let status = {};
  const sol = fmin(x => Math.abs(f(x)), {lowerBound: blow, upperBound: bhigh, tolerance}, status)
  if (!status.converged) { throw new Error('failed to converge'); }
  return exp(sol) * t0;
}

module.exports = {
  updateRecall,
  predictRecall,
  defaultModel,
  modelToPercentileDecay,
};

},{"./logsumexp":2,"gamma":3,"minimize-golden-section-1d":4}],2:[function(require,module,exports){
var exp = Math.exp;
var log = Math.log;
var sign = Math.sign;
var max = Math.max;

function logsumexp(a, b) {
  var a_max = max(...a);
  var s = 0;
  for (let i = a.length - 1; i >= 0; i--) { s += b[i] * exp(a[i] - a_max); }
  var sgn = sign(s);
  s *= sgn;
  var out = log(s) + a_max;
  return [out, sgn];
}
module.exports = logsumexp;

},{}],3:[function(require,module,exports){
// transliterated from the python snippet here:
// http://en.wikipedia.org/wiki/Lanczos_approximation

var g = 7;
var p = [
    0.99999999999980993,
    676.5203681218851,
    -1259.1392167224028,
    771.32342877765313,
    -176.61502916214059,
    12.507343278686905,
    -0.13857109526572012,
    9.9843695780195716e-6,
    1.5056327351493116e-7
];

var g_ln = 607/128;
var p_ln = [
    0.99999999999999709182,
    57.156235665862923517,
    -59.597960355475491248,
    14.136097974741747174,
    -0.49191381609762019978,
    0.33994649984811888699e-4,
    0.46523628927048575665e-4,
    -0.98374475304879564677e-4,
    0.15808870322491248884e-3,
    -0.21026444172410488319e-3,
    0.21743961811521264320e-3,
    -0.16431810653676389022e-3,
    0.84418223983852743293e-4,
    -0.26190838401581408670e-4,
    0.36899182659531622704e-5
];

// Spouge approximation (suitable for large arguments)
function lngamma(z) {

    if(z < 0) return Number('0/0');
    var x = p_ln[0];
    for(var i = p_ln.length - 1; i > 0; --i) x += p_ln[i] / (z + i);
    var t = z + g_ln + 0.5;
    return .5*Math.log(2*Math.PI)+(z+.5)*Math.log(t)-t+Math.log(x)-Math.log(z);
}

module.exports = function gamma (z) {
    if (z < 0.5) {
        return Math.PI / (Math.sin(Math.PI * z) * gamma(1 - z));
    }
    else if(z > 100) return Math.exp(lngamma(z));
    else {
        z -= 1;
        var x = p[0];
        for (var i = 1; i < g + 2; i++) {
            x += p[i] / (z + i);
        }
        var t = z + g + 0.5;

        return Math.sqrt(2 * Math.PI)
            * Math.pow(t, z + 0.5)
            * Math.exp(-t)
            * x
        ;
    }
};

module.exports.log = lngamma;

},{}],4:[function(require,module,exports){
'use strict';

var goldenSectionMinimize = require('./src/golden-section-minimize');
var bracketMinimum = require('./src/bracket-minimum');

var bounds = [0, 0];

module.exports = function minimize (f, options, status) {
  options = options || {};
  var x0;
  var tolerance = options.tolerance === undefined ? 1e-8 : options.tolerance;
  var dx = options.initialIncrement === undefined ? 1 : options.initialIncrement;
  var xMin = options.lowerBound === undefined ? -Infinity : options.lowerBound;
  var xMax = options.upperBound === undefined ? Infinity : options.upperBound;
  var maxIterations = options.maxIterations === undefined ? 100 : options.maxIterations;

  if (status) {
    status.iterations = 0;
    status.argmin = NaN;
    status.minimum = Infinity;
    status.converged = false;
  }

  if (isFinite(xMax) && isFinite(xMin)) {
    bounds[0] = xMin;
    bounds[1] = xMax;
  } else {
    // Construct the best guess we can:
    if (options.guess === undefined) {
      if (xMin > -Infinity) {
        x0 = xMax < Infinity ? 0.5 * (xMin + xMax) : xMin;
      } else {
        x0 = xMax < Infinity ? xMax : 0;
      }
    } else {
      x0 = options.guess;
    }

    bracketMinimum(bounds, f, x0, dx, xMin, xMax, maxIterations);

    if (isNaN(bounds[0]) || isNaN(bounds[1])) {
      return NaN;
    }
  }

  return goldenSectionMinimize(f, bounds[0], bounds[1], tolerance, maxIterations, status);
};

},{"./src/bracket-minimum":5,"./src/golden-section-minimize":6}],5:[function(require,module,exports){
'use strict';

module.exports = bracketMinimum;

function bracketMinimum (bounds, f, x0, dx, xMin, xMax, maxIter) {
  // If either size is unbounded (=infinite), Expand the guess
  // range until we either bracket a minimum or until we reach the bounds:
  var fU, fL, fMin, n, xL, xU, bounded;
  n = 1;
  xL = x0;
  xU = x0;
  fMin = fL = fU = f(x0);
  while (!bounded && isFinite(dx) && !isNaN(dx)) {
    ++n;
    bounded = true;

    if (fL <= fMin) {
      fMin = fL;
      xL = Math.max(xMin, xL - dx);
      fL = f(xL);
      bounded = false;
    }
    if (fU <= fMin) {
      fMin = fU;
      xU = Math.min(xMax, xU + dx);
      fU = f(xU);
      bounded = false;
    }

    // Track the smallest value seen so far:
    fMin = Math.min(fMin, fL, fU);

    // If either of these is the case, then the function appears
    // to be minimized against one of the bounds, so although we
    // haven't bracketed a minimum, we'll considere the procedure
    // complete because we appear to have bracketed a minimum
    // against a bound:
    if ((fL === fMin && xL === xMin) || (fU === fMin && xU === xMax)) {
      bounded = true;
    }

    // Increase the increment at a very quickly increasing rate to account
    // for the fact that we have *no* idea what floating point magnitude is
    // desirable. In order to avoid this, you should really provide *any
    // reasonable bounds at all* for the variables.
    dx *= n < 4 ? 2 : Math.exp(n * 0.5);

    if (!isFinite(dx)) {
      bounds[0] = -Infinity;
      bounds[1] = Infinity;
      return bounds;
    }
  }

  bounds[0] = xL;
  bounds[1] = xU;
  return bounds;
}

},{}],6:[function(require,module,exports){
'use strict';

var PHI_RATIO = 2 / (1 + Math.sqrt(5));

module.exports = goldenSectionMinimize;

function goldenSectionMinimize (f, xL, xU, tol, maxIterations, status) {
  var xF, fF;
  var iteration = 0;
  var x1 = xU - PHI_RATIO * (xU - xL);
  var x2 = xL + PHI_RATIO * (xU - xL);
  // Initial bounds:
  var f1 = f(x1);
  var f2 = f(x2);

  // Store these values so that we can return these if they're better.
  // This happens when the minimization falls *approaches* but never
  // actually reaches one of the bounds
  var f10 = f(xL);
  var f20 = f(xU);
  var xL0 = xL;
  var xU0 = xU;

  // Simple, robust golden section minimization:
  while (++iteration < maxIterations && Math.abs(xU - xL) > tol) {
    if (f2 > f1) {
      xU = x2;
      x2 = x1;
      f2 = f1;
      x1 = xU - PHI_RATIO * (xU - xL);
      f1 = f(x1);
    } else {
      xL = x1;
      x1 = x2;
      f1 = f2;
      x2 = xL + PHI_RATIO * (xU - xL);
      f2 = f(x2);
    }
  }

  xF = 0.5 * (xU + xL);
  fF = 0.5 * (f1 + f2);

  if (status) {
    status.iterations = iteration;
    status.argmin = xF;
    status.minimum = fF;
    status.converged = true;
  }

  if (isNaN(f2) || isNaN(f1) || iteration === maxIterations) {
    if (status) {
      status.converged = false;
    }
    return NaN;
  }

  if (f10 < fF) {
    return xL0;
  } else if (f20 < fF) {
    return xU0;
  } else {
    return xF;
  }
}

},{}]},{},[1])(1)
});
