/**
 * Painel de análise: rede neural em SVG (camadas, arestas com fluxo, nós pulsantes).
 * GSAP 3 — start(container) / stop() com gsap.context.
 */
(function (global) {
  "use strict";

  var ctx = null;
  var SVG_NS = "http://www.w3.org/2000/svg";

  function yPositions(n, top, bot) {
    if (n <= 1) return [(top + bot) / 2];
    var ys = [];
    for (var i = 0; i < n; i++) ys.push(top + (i * (bot - top)) / (n - 1));
    return ys;
  }

  /**
   * Monta SVG estilo multilayer perceptron (conexões densas entre camadas adjacentes).
   * @param {HTMLElement} host
   */
  function buildNeuralSvg(host) {
    host.innerHTML = "";

    var svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 340 240");
    svg.setAttribute("class", "ai-gsap-neural-svg");
    /* Cobre todo o retângulo do painel (equivalente a object-fit: cover). */
    svg.setAttribute("preserveAspectRatio", "xMidYMid slice");

    var defs = document.createElementNS(SVG_NS, "defs");
    var filter = document.createElementNS(SVG_NS, "filter");
    filter.setAttribute("id", "nnNodeGlow");
    filter.setAttribute("x", "-50%");
    filter.setAttribute("y", "-50%");
    filter.setAttribute("width", "200%");
    filter.setAttribute("height", "200%");
    var blur = document.createElementNS(SVG_NS, "feGaussianBlur");
    blur.setAttribute("stdDeviation", "0.9");
    blur.setAttribute("result", "blur");
    var merge = document.createElementNS(SVG_NS, "feMerge");
    var m1 = document.createElementNS(SVG_NS, "feMergeNode");
    m1.setAttribute("in", "blur");
    var m2 = document.createElementNS(SVG_NS, "feMergeNode");
    m2.setAttribute("in", "SourceGraphic");
    merge.appendChild(m1);
    merge.appendChild(m2);
    filter.appendChild(blur);
    filter.appendChild(merge);
    defs.appendChild(filter);
    svg.appendChild(defs);

    /* Camadas espalhadas no viewBox inteiro (evita “faixa” pequena no centro). */
    var layerX = [28, 112, 228, 312];
    var layerN = [5, 8, 8, 5];
    var top = 22;
    var bot = 218;

    var layers = [];
    for (var L = 0; L < layerN.length; L++) {
      var ys = yPositions(layerN[L], top, bot);
      var layer = [];
      for (var k = 0; k < ys.length; k++) layer.push({ x: layerX[L], y: ys[k] });
      layers.push(layer);
    }

    var gEdges = document.createElementNS(SVG_NS, "g");
    gEdges.setAttribute("class", "nn-edges");

    for (var li = 0; li < layers.length - 1; li++) {
      for (var i = 0; i < layers[li].length; i++) {
        for (var j = 0; j < layers[li + 1].length; j++) {
          var a = layers[li][i];
          var b = layers[li + 1][j];
          var line = document.createElementNS(SVG_NS, "line");
          line.setAttribute("x1", String(a.x));
          line.setAttribute("y1", String(a.y));
          line.setAttribute("x2", String(b.x));
          line.setAttribute("y2", String(b.y));
          line.setAttribute("class", "nn-edge");
          line.setAttribute("stroke-dasharray", "2 7");
          line.setAttribute("stroke-dashoffset", "0");
          gEdges.appendChild(line);
        }
      }
    }
    svg.appendChild(gEdges);

    var gNodes = document.createElementNS(SVG_NS, "g");
    gNodes.setAttribute("class", "nn-nodes");
    for (var Ln = 0; Ln < layers.length; Ln++) {
      for (var ni = 0; ni < layers[Ln].length; ni++) {
        var p = layers[Ln][ni];
        var c = document.createElementNS(SVG_NS, "circle");
        c.setAttribute("cx", String(p.x));
        c.setAttribute("cy", String(p.y));
        c.setAttribute("r", "3.8");
        c.setAttribute("class", "nn-node");
        c.setAttribute("filter", "url(#nnNodeGlow)");
        gNodes.appendChild(c);
      }
    }
    svg.appendChild(gNodes);

    host.appendChild(svg);
  }

  function start(containerEl) {
    if (!global.gsap || !containerEl) return;
    stop();

    var stage = containerEl.querySelector(".ai-gsap-stage");
    if (!stage) return;

    var neuralHost = stage.querySelector(".ai-gsap-neural");
    var bg = stage.querySelector(".ai-gsap-bg");

    if (neuralHost) buildNeuralSvg(neuralHost);

    ctx = gsap.context(function () {
      if (bg) {
        gsap.to(bg, {
          opacity: 0.72,
          duration: 1.1,
          repeat: -1,
          yoyo: true,
          ease: "sine.inOut",
        });
      }

      var edges = neuralHost ? neuralHost.querySelectorAll(".nn-edge") : [];
      var nodes = neuralHost ? neuralHost.querySelectorAll(".nn-node") : [];

      edges.forEach(function (line, idx) {
        gsap.to(line, {
          strokeDashoffset: -36,
          duration: 0.95 + (idx % 11) * 0.045,
          repeat: -1,
          ease: "none",
          delay: idx * 0.006,
        });
        gsap.to(line, {
          opacity: 0.38,
          duration: 0.55,
          repeat: -1,
          yoyo: true,
          ease: "sine.inOut",
          delay: idx * 0.011,
        });
      });

      if (nodes.length) {
        gsap
          .timeline({ repeat: -1, repeatDelay: 0.08 })
          .to(nodes, {
            attr: { r: 5.4 },
            opacity: 1,
            duration: 0.28,
            stagger: { each: 0.032, from: "start" },
            ease: "power2.out",
          })
          .to(nodes, {
            attr: { r: 3.8 },
            opacity: 0.92,
            duration: 0.32,
            stagger: { each: 0.028, from: "end" },
            ease: "power2.in",
          });
      }
    }, stage);
  }

  function stop() {
    if (ctx) {
      ctx.revert();
      ctx = null;
    }
  }

  global.AiThinkingGsap = { start: start, stop: stop };
})(typeof window !== "undefined" ? window : globalThis);
