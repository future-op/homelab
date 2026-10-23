/* Homelab site: renders everything from data/content.json, data/services.json and data/status.json.
   No dependencies. All text is inserted with textContent (safe for edited data). */
(function () {
  'use strict';

  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var SVGNS = 'http://www.w3.org/2000/svg';

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function svg(tag, attrs) {
    var n = document.createElementNS(SVGNS, tag);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  }
  function getJSON(url) {
    return fetch(url, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error(url + ' -> HTTP ' + r.status);
      return r.json();
    });
  }
  function tagList(tags) {
    var ul = el('ul', 'tags');
    (tags || []).forEach(function (t) { ul.appendChild(el('li', 'tag', t)); });
    return ul;
  }

  /* ---------- icons (simple stroke SVGs) ---------- */
  var ICONS = {
    server: '<rect x="3" y="4" width="18" height="6" rx="1"/><rect x="3" y="14" width="18" height="6" rx="1"/><path d="M7 7h.01M7 17h.01M12 7h6M12 17h6"/>',
    storage: '<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>',
    chip: '<rect x="6" y="6" width="12" height="12" rx="1"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>',
    shield: '<path d="M12 3l8 3v6c0 4.5-3.2 8-8 9-4.8-1-8-4.5-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
    network: '<rect x="9" y="3" width="6" height="5" rx="1"/><rect x="3" y="16" width="6" height="5" rx="1"/><rect x="15" y="16" width="6" height="5" rx="1"/><path d="M12 8v4M6 16v-4h12v4"/>',
    power: '<path d="M12 3v8"/><path d="M6.3 6.8a8 8 0 1 0 11.4 0"/>'
  };
  function icon(name) {
    var s = svg('svg', { viewBox: '0 0 24 24', 'class': 'ico', fill: 'none', stroke: 'currentColor',
      'stroke-width': '1.6', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false' });
    s.innerHTML = ICONS[name] || ICONS.server; // static strings defined above, not user data
    return s;
  }

  /* ---------- boot intro ---------- */
  var bootTimer = null, bootDone = false;
  function colorize(line) {
    var span = el('span');
    var m = /^\[(\s*OK\s*|WARN|INFO|FAIL)\]\s?(.*)$/.exec(line);
    if (m) {
      var tag = m[1].trim();
      span.appendChild(document.createTextNode('['));
      span.appendChild(el('span', tag === 'OK' ? 'ok' : (tag === 'INFO' ? 'info' : 'warn'), tag === 'OK' ? ' OK ' : tag));
      span.appendChild(document.createTextNode('] ' + m[2]));
    } else {
      span.className = 'hl';
      span.textContent = line;
    }
    return span;
  }
  function renderBootFull(lines) {
    var pre = $('boot');
    pre.textContent = '';
    lines.forEach(function (l) { pre.appendChild(colorize(l)); pre.appendChild(document.createTextNode('\n')); });
  }
  function runBoot(lines) {
    var pre = $('boot'), skip = $('skip-boot');
    function finish() {
      if (bootDone) return;
      bootDone = true;
      clearTimeout(bootTimer);
      renderBootFull(lines);
      skip.hidden = true;
      pre.setAttribute('aria-label', lines.join('. '));
    }
    skip.addEventListener('click', finish);
    if (reduceMotion || !lines.length) { finish(); return; }
    var li = 0, ci = 0, current = null, cursorEl = el('span', 'cursor');
    function step() {
      if (bootDone) return;
      if (li >= lines.length) { finish(); return; }
      var line = lines[li];
      if (ci === 0) {
        current = el('span'); pre.appendChild(current);
        pre.appendChild(cursorEl);
      }
      // type "[ OK ]" prefixes instantly, free text char by char
      var prefix = /^\[[^\]]*\]\s?/.exec(line);
      var jump = (ci === 0 && prefix) ? prefix[0].length : 1;
      ci += jump;
      current.textContent = line.slice(0, ci);
      if (ci >= line.length) {
        pre.replaceChild(colorize(line), current);
        pre.insertBefore(document.createTextNode('\n'), cursorEl);
        li++; ci = 0;
        bootTimer = setTimeout(step, 140);
      } else {
        bootTimer = setTimeout(step, 14);
      }
    }
    step();
  }

  /* ---------- sections ---------- */
  function renderHome(c) {
    var s = c.site || {};
    document.title = s.title || document.title;
    $('brand-user').textContent = (s.user || 'user') + '@' + (s.host || 'homelab');
    $('home-cmd').textContent = (c.home && c.home.heading) || 'whoami';
    var bio = $('bio');
    ((c.home && c.home.bio) || []).forEach(function (p) { bio.appendChild(el('p', null, p)); });
    var facts = $('facts');
    ((c.home && c.home.facts) || []).forEach(function (f) {
      var d = el('div'); d.appendChild(el('dt', null, f.key)); d.appendChild(el('dd', null, f.value)); facts.appendChild(d);
    });
    $('footer').textContent = c.footer || '';
  }

  function renderHardware(h) {
    $('hardware-intro').textContent = h.intro || '';
    var grid = $('hardware-grid');
    (h.items || []).forEach(function (it) {
      var card = el('article', 'card');
      var head = el('div', 'card-head');
      head.appendChild(icon(it.icon));
      var t = el('div');
      t.appendChild(el('h3', null, it.name));
      t.appendChild(el('p', 'role', it.role));
      head.appendChild(t);
      card.appendChild(head);
      var dl = el('dl', 'specs');
      (it.specs || []).forEach(function (kv) { dl.appendChild(el('dt', null, kv[0])); dl.appendChild(el('dd', null, kv[1])); });
      card.appendChild(dl);
      card.appendChild(tagList(it.tags));
      grid.appendChild(card);
    });
  }

  function renderNetwork(n) {
    $('network-intro').textContent = n.intro || '';
    var d = n.diagram || { nodes: [], links: [], groups: [] };
    var pad = 16;
    var maxX = 0, maxY = 0, byId = {};
    (d.groups || []).forEach(function (g) {
      maxX = Math.max(maxX, g.x + g.w);
      maxY = Math.max(maxY, g.y + g.h);
    });
    d.nodes.forEach(function (nd) {
      byId[nd.id] = nd;
      maxX = Math.max(maxX, nd.x + nd.w);
      maxY = Math.max(maxY, nd.y + nd.h);
    });
    var vbW = maxX + pad, vbH = maxY + 56;
    var s = svg('svg', {
      viewBox: '0 0 ' + vbW + ' ' + vbH,
      preserveAspectRatio: 'xMidYMid meet',
      'class': 'topo-svg',
      role: 'img'
    });
    var title = svg('title', {});
    title.textContent = 'Network topology: Internet to pfSense to MikroTik core switch, Proxmox nodes, and a nested VMware lab on an isolated VLAN';
    s.appendChild(title);
    var desc = svg('desc', {});
    desc.textContent = 'Every device connects upstream. Link colors show speed: cyan for 2.5 GbE, yellow for 1 GbE, pink for the isolated nested lab segment.';
    s.appendChild(desc);

    /* defs: neon glow + arrow */
    var defs = svg('defs', {});
    var glow = svg('filter', { id: 'neon', x: '-40%', y: '-40%', width: '180%', height: '180%' });
    glow.appendChild(svg('feGaussianBlur', { stdDeviation: '2.2', result: 'b' }));
    var merge = svg('feMerge', {});
    merge.appendChild(svg('feMergeNode', { in: 'b' }));
    merge.appendChild(svg('feMergeNode', { in: 'SourceGraphic' }));
    glow.appendChild(merge);
    defs.appendChild(glow);
    var glowP = svg('filter', { id: 'neon-pink', x: '-50%', y: '-50%', width: '200%', height: '200%' });
    glowP.appendChild(svg('feGaussianBlur', { stdDeviation: '3', result: 'b' }));
    var mergeP = svg('feMerge', {});
    mergeP.appendChild(svg('feMergeNode', { in: 'b' }));
    mergeP.appendChild(svg('feMergeNode', { in: 'SourceGraphic' }));
    glowP.appendChild(mergeP);
    defs.appendChild(glowP);
    s.appendChild(defs);

    /* subtle grid */
    var grid = svg('g', { 'class': 'topo-grid', 'aria-hidden': 'true' });
    var gx, gy;
    for (gx = 0; gx <= vbW; gx += 40) {
      grid.appendChild(svg('line', { x1: gx, y1: 0, x2: gx, y2: vbH }));
    }
    for (gy = 0; gy <= vbH; gy += 40) {
      grid.appendChild(svg('line', { x1: 0, y1: gy, x2: vbW, y2: gy }));
    }
    s.appendChild(grid);

    function clipPath(x, y, w, h, cut) {
      cut = cut || 10;
      return 'M' + (x + cut) + ' ' + y +
        'H' + (x + w) +
        'V' + (y + h - cut) +
        'L' + (x + w - cut) + ' ' + (y + h) +
        'H' + x +
        'V' + (y + cut) + 'Z';
    }

    function anchor(a, b) {
      var acx = a.x + a.w / 2, acy = a.y + a.h / 2;
      var bcx = b.x + b.w / 2, bcy = b.y + b.h / 2;
      var dx = bcx - acx, dy = bcy - acy;
      var from, to;
      if (Math.abs(dx) > Math.abs(dy) * 1.15) {
        /* mostly horizontal */
        if (dx > 0) {
          from = { x: a.x + a.w, y: acy };
          to = { x: b.x, y: bcy };
        } else {
          from = { x: a.x, y: acy };
          to = { x: b.x + b.w, y: bcy };
        }
      } else {
        if (dy > 0) {
          from = { x: acx, y: a.y + a.h };
          to = { x: bcx, y: b.y };
        } else {
          from = { x: acx, y: a.y };
          to = { x: bcx, y: b.y + b.h };
        }
      }
      return { from: from, to: to };
    }

    function orthoPath(p1, p2) {
      var mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
      if (Math.abs(p1.x - p2.x) < 2 || Math.abs(p1.y - p2.y) < 2) {
        return 'M' + p1.x + ' ' + p1.y + ' L' + p2.x + ' ' + p2.y;
      }
      /* downward fan: drop a short stub, then horizontal, then into target */
      if (p2.y > p1.y + 8) {
        var stub = p1.y + Math.min(28, (p2.y - p1.y) * 0.35);
        return 'M' + p1.x + ' ' + p1.y + ' L' + p1.x + ' ' + stub + ' L' + p2.x + ' ' + stub + ' L' + p2.x + ' ' + p2.y;
      }
      if (Math.abs(p2.y - p1.y) >= Math.abs(p2.x - p1.x)) {
        return 'M' + p1.x + ' ' + p1.y + ' L' + p1.x + ' ' + my + ' L' + p2.x + ' ' + my + ' L' + p2.x + ' ' + p2.y;
      }
      return 'M' + p1.x + ' ' + p1.y + ' L' + mx + ' ' + p1.y + ' L' + mx + ' ' + p2.y + ' L' + p2.x + ' ' + p2.y;
    }

    function speedClass(sp) {
      if (sp === '2.5g') return 'lnk lnk-25';
      if (sp === '1g') return 'lnk lnk-1g';
      if (sp === 'lab') return 'lnk lnk-lab';
      if (sp === 'remote') return 'lnk lnk-remote';
      if (sp === 'iot') return 'lnk lnk-iot';
      if (sp === 'wan') return 'lnk lnk-wan';
      return 'lnk lnk-1g';
    }

    function speedLabel(sp) {
      if (sp === '2.5g') return '2.5 GbE';
      if (sp === '1g') return '1 GbE';
      if (sp === 'lab') return 'lab';
      if (sp === 'remote') return 'overlay';
      if (sp === 'iot') return 'IoT';
      if (sp === 'wan') return 'WAN';
      return '';
    }

    function normalizeLink(l) {
      if (Array.isArray(l)) return { from: l[0], to: l[1], speed: l[2] || '1g' };
      return { from: l.from || l[0], to: l.to || l[1], speed: l.speed || '1g' };
    }

    /* groups (isolated nested lab boundary) behind links */
    (d.groups || []).forEach(function (g) {
      var gg = svg('g', { 'class': 'topo-group' });
      var border = svg('path', {
        'class': 'topo-group-border',
        d: clipPath(g.x, g.y, g.w, g.h, 16),
        fill: 'rgba(255,43,214,.06)',
        filter: 'url(#neon-pink)'
      });
      gg.appendChild(border);
      var lab = svg('text', {
        'class': 'topo-group-label',
        x: g.x + 18, y: g.y + 22
      });
      lab.textContent = g.label || '';
      gg.appendChild(lab);
      if (g.sub) {
        var sub = svg('text', {
          'class': 'topo-group-sub',
          x: g.x + 18, y: g.y + 38
        });
        sub.textContent = g.sub;
        gg.appendChild(sub);
      }
      s.appendChild(gg);
    });

    /* links */
    var linkLayer = svg('g', { 'class': 'topo-links' });
    var packetLayer = svg('g', { 'class': 'topo-packets', 'aria-hidden': 'true' });
    var labelLayer = svg('g', { 'class': 'topo-link-labels' });
    var linkMeta = [];
    d.links.forEach(function (raw, i) {
      var l = normalizeLink(raw);
      var a = byId[l.from], b = byId[l.to];
      if (!a || !b) return;
      var ends = anchor(a, b);
      var dPath;
      if (l.speed === 'lab' && Math.abs(ends.to.x - ends.from.x) > 120) {
        var c1x = ends.from.x + (ends.to.x - ends.from.x) * 0.45;
        var c2x = ends.from.x + (ends.to.x - ends.from.x) * 0.55;
        dPath = 'M' + ends.from.x + ' ' + ends.from.y +
          ' C' + c1x + ' ' + ends.from.y + ' ' + c2x + ' ' + ends.to.y + ' ' + ends.to.x + ' ' + ends.to.y;
      } else {
        dPath = orthoPath(ends.from, ends.to);
      }
      var pid = 'lp' + i;
      var pathAttrs = {
        id: pid,
        'class': speedClass(l.speed),
        d: dPath,
        fill: 'none'
      };
      if (l.speed === 'lab' || l.speed === '2.5g') pathAttrs.filter = 'url(#neon)';
      var path = svg('path', pathAttrs);
      linkLayer.appendChild(path);
      linkMeta.push({ path: path, speed: l.speed, from: ends.from, to: ends.to, d: dPath, id: pid });

      var lbl = speedLabel(l.speed);
      /* only label distinctive uplink speeds on longer spans */
      if ((l.speed === '2.5g' || l.speed === 'lab' || l.speed === 'wan') && Math.hypot(ends.to.x - ends.from.x, ends.to.y - ends.from.y) > 70) {
        var lx = (ends.from.x + ends.to.x) / 2;
        var ly = (ends.from.y + ends.to.y) / 2 - 6;
        var t = svg('text', { 'class': 'lnk-label lnk-label-' + String(l.speed).replace('.', ''), x: lx, y: ly });
        t.textContent = lbl;
        labelLayer.appendChild(t);
      }
    });
    s.appendChild(linkLayer);
    s.appendChild(labelLayer);

    /* animated packets */
    if (!reduceMotion) {
      linkMeta.forEach(function (m, i) {
        if (m.speed === 'iot' && i % 2) return;
        var c = svg('circle', {
          'class': 'pkt pkt-' + String(m.speed).replace('.', ''),
          r: m.speed === '2.5g' || m.speed === 'lab' ? 3.2 : 2.4,
          cx: 0, cy: 0
        });
        var am = document.createElementNS(SVGNS, 'animateMotion');
        am.setAttribute('dur', (m.speed === '2.5g' ? 2.2 : m.speed === 'lab' ? 2.8 : 3.4) + 's');
        am.setAttribute('repeatCount', 'indefinite');
        am.setAttribute('begin', (i * 0.18) + 's');
        var mpath = document.createElementNS(SVGNS, 'mpath');
        mpath.setAttributeNS('http://www.w3.org/1999/xlink', 'href', '#' + m.id);
        mpath.setAttribute('href', '#' + m.id);
        am.appendChild(mpath);
        c.appendChild(am);
        packetLayer.appendChild(c);
      });
    }
    s.appendChild(packetLayer);

    /* nodes */
    function kindClass(nd) {
      var k = nd.kind || '';
      if (k) return 'dn dn-' + k;
      if (/^v\d/.test(nd.id)) return 'dn dn-vlan';
      return 'dn dn-node';
    }
    d.nodes.forEach(function (nd) {
      var g = svg('g', { 'class': kindClass(nd) });
      var body = svg('path', {
        'class': 'dn-body',
        d: clipPath(nd.x, nd.y, nd.w, nd.h, 9)
      });
      g.appendChild(body);
      /* accent bar */
      g.appendChild(svg('path', {
        'class': 'dn-accent',
        d: 'M' + (nd.x + 10) + ' ' + (nd.y + 2) + 'H' + (nd.x + Math.min(36, nd.w - 12))
      }));
      var t1 = svg('text', { 'class': 't1', x: nd.x + nd.w / 2, y: nd.y + (nd.sub ? 20 : 28) });
      t1.textContent = nd.label;
      g.appendChild(t1);
      if (nd.sub) {
        var t2 = svg('text', { 'class': 't2', x: nd.x + nd.w / 2, y: nd.y + 36 });
        t2.textContent = nd.sub;
        g.appendChild(t2);
      }
      s.appendChild(g);
    });

    /* legend */
    var legend = svg('g', { 'class': 'topo-legend', transform: 'translate(16 ' + (maxY + 18) + ')' });
    var items = [
      { cls: 'lnk-25', label: '2.5 GbE' },
      { cls: 'lnk-1g', label: '1 GbE' },
      { cls: 'lnk-lab', label: 'Nested lab VLAN' },
      { cls: 'lnk-remote', label: 'Overlay / remote' },
      { cls: 'lnk-wan', label: 'WAN' }
    ];
    var lx = 0;
    items.forEach(function (it) {
      legend.appendChild(svg('line', {
        'class': 'lnk ' + it.cls,
        x1: lx, y1: 0, x2: lx + 28, y2: 0
      }));
      var lt = svg('text', { 'class': 'legend-t', x: lx + 34, y: 4 });
      lt.textContent = it.label;
      legend.appendChild(lt);
      lx += 28 + it.label.length * 7.2 + 22;
    });
    s.appendChild(legend);

    var host = $('diagram');
    host.textContent = '';
    host.appendChild(s);
    $('diagram-cap').textContent = d.caption || '';

    /* VLAN table + side cards (unchanged behavior) */
    var vl = n.vlans || [], hasSubnet = vl.some(function (v) { return v.subnet; });
    var cols = vl.some(function (v) { return v.id != null; }) ? [['ID', 'id'], ['Name', 'name']] : [['Name', 'name']];
    if (hasSubnet) cols.push(['Subnet', 'subnet']);
    cols.push(['Note', 'note']);
    var hr = $('vlan-table').tHead.rows[0]; hr.textContent = '';
    cols.forEach(function (c) { var th = el('th', null, c[0]); th.scope = 'col'; hr.appendChild(th); });
    var tb = $('vlan-table').tBodies[0];
    tb.textContent = '';
    vl.forEach(function (v) {
      var tr = el('tr');
      cols.forEach(function (c) { tr.appendChild(el('td', null, v[c[1]] == null ? '' : String(v[c[1]]))); });
      tb.appendChild(tr);
    });
    [['dns-card', n.dns], ['vpn-card', n.vpn]].forEach(function (p) {
      var box = $(p[0]); if (!p[1]) return;
      box.textContent = '';
      box.appendChild(el('h3', null, p[1].title));
      var ul = el('ul'); p[1].points.forEach(function (x) { ul.appendChild(el('li', null, x)); });
      box.appendChild(ul);
    });
  }

  var MONTHS = ['january','february','march','april','may','june','july','august','september','october','november','december'];
  function isoDate(s) {
    s = String(s).trim();
    if (/^\d{4}(-\d{2}){0,2}$/.test(s)) return s;
    var m = /^([A-Za-z]+)\s+(\d{4})$/.exec(s), i = m ? MONTHS.indexOf(m[1].toLowerCase()) : -1;
    return i < 0 ? '' : m[2] + '-' + (i < 9 ? '0' : '') + (i + 1);
  }

  function renderProjects(p) {
    $('projects-intro').textContent = p.intro || '';
    var items = (p.items || []).slice(); // file order (no sorting); "date" is an optional free-form string, only shown when set
    var list = $('project-list'), filters = $('tag-filters'), active = null;
    var tags = {};
    items.forEach(function (it) {
      var li = el('li', 'proj' + (it.date ? '' : ' nodate'));
      if (it.date) {
        // date is a free-form string ("October 2026", "2026-10-11", ...); machine-readable
        // datetime is only set when it can be worked out
        var time = el('time', null, it.date), iso = isoDate(it.date);
        if (iso) time.setAttribute('datetime', iso);
        li.appendChild(time);
      }
      var body = el('div');
      var h = el('h3'), a;
      if (it.url) { a = el('a', null, it.title); a.href = it.url; h.appendChild(a); } else { h.textContent = it.title; }
      body.appendChild(h);
      [].concat(it.summary || []).forEach(function (t) { body.appendChild(el('p', null, t)); }); // summary: string or array of paragraphs
      body.appendChild(tagList(it.tags));
      li.appendChild(body); list.appendChild(li);
      it._el = li;
      (it.tags || []).forEach(function (t) { tags[t] = 1; });
    });
    function apply() {
      items.forEach(function (it) { it._el.hidden = !!active && (it.tags || []).indexOf(active) < 0; });
      Array.prototype.forEach.call(filters.children, function (b) { b.setAttribute('aria-pressed', String((b.dataset.tag || null) === active)); });
    }
    // Tag chips: only tags used by 2+ projects (keeps the filter bar short). If fewer than
    // 3 qualify, fall back to every tag.
    var counts = {};
    items.forEach(function (it) { (it.tags || []).forEach(function (t) { counts[t] = (counts[t] || 0) + 1; }); });
    var shared = Object.keys(counts).filter(function (t) { return counts[t] > 1; });
    var chipTags = shared.length >= 3 ? shared : Object.keys(tags);
    ['all'].concat(chipTags.sort()).forEach(function (t) {
      var b = el('button', 'chip', t === 'all' ? 'all' : '#' + t);
      b.type = 'button'; if (t !== 'all') b.dataset.tag = t;
      b.addEventListener('click', function () { active = t === 'all' ? null : t; apply(); });
      filters.appendChild(b);
    });
    apply();
  }

  /* ---------- status board ----------
     Static metadata (id, name, node, desc) comes from data/services.json.
     Live state comes from data/status.json ({updated, services:[{id, name, state}]}),
     matched by id and polled every refreshSeconds with a cache-busting query string.
     If the feed is missing, unreadable or older than staleMinutes, every tile shows a
     neutral UNKNOWN badge and a "feed stale" notice is displayed.
     When the feed is FRESH, a service whose id is absent from it is still shown, as UNKNOWN,
     and counted as unknown in the summary, so every tile always appears. */
  var STATUS_DEFAULTS = {
    refreshSeconds: 1800,  // browser polls the feed every 30 minutes (collector publishes every 6 hours)
    staleMinutes: 480      // feed older than 8 hours shows UNKNOWN (one missed 6-hour run plus slack)
  };
  var statusCfg = {}, services = [], feed = null, feedError = null, pollTimer = null;
  var LABEL = { up: 'UP', stopped: 'STOPPED', down: 'DOWN', degraded: 'DEGRADED', unknown: 'UNKNOWN' };

  function statusMax() { return statusCfg.staleMinutes || STATUS_DEFAULTS.staleMinutes; }
  function feedAgeMs() {
    if (!feed || !feed.updated) return null;
    var t = Date.parse(feed.updated);
    return isNaN(t) ? null : Date.now() - t;
  }
  function isStale() {
    var age = feedAgeMs(), max = statusMax() * 60000;
    return age === null || age > max || age < -5 * 60000;   // missing, too old, or far in the future
  }
  function fmtAge(ms) {
    var m = Math.round(ms / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return m + ' min ago';
    var h = Math.floor(m / 60), r = m % 60;
    if (h < 48) return h + ' h' + (r ? ' ' + r + ' min' : '') + ' ago';
    return Math.floor(h / 24) + ' d ago';
  }
  function fmtDuration(min) {
    return (min % 60 === 0 && min >= 120) ? (min / 60) + ' hours' : (min === 60 ? '1 hour' : min + ' minutes');
  }

  function renderStatus() {
    var grid = $('status-grid'); grid.textContent = '';
    var stale = isStale();
    var states = {};
    if (feed && Array.isArray(feed.services)) feed.services.forEach(function (f) { if (f && f.id) states[f.id] = f.state; });
    var counts = { up: 0, stopped: 0, down: 0, degraded: 0, unknown: 0 };
    var shown = 0;
    services.forEach(function (s) {
      shown++;
      var st = (!stale && LABEL[states[s.id]]) ? states[s.id] : 'unknown';
      counts[st]++;
      var card = el('article', 'svc ' + st);
      var top = el('div', 'svc-top');
      top.appendChild(el('h3', null, s.name));
      top.appendChild(el('span', 'badge', LABEL[st]));
      card.appendChild(top);
      card.appendChild(el('div', 'meta', s.node || ''));
      if (s.desc) card.appendChild(el('div', 'desc', s.desc));
      grid.appendChild(card);
    });

    if (!shown) grid.appendChild(el('p', 'notice', 'No services defined.'));

    var sum = $('summary'); sum.textContent = '';
    sum.appendChild(document.createTextNode('$ summary: '));
    var first = true;
    [['up', 'var(--green)'], ['stopped', 'var(--dim)'], ['degraded', 'var(--amber)'], ['down', 'var(--red)'], ['unknown', 'var(--dim)']].forEach(function (k) {
      // always show up/degraded/down; show stopped/unknown only if present
      if ((k[0] === 'unknown' || k[0] === 'stopped') && !counts[k[0]]) return;
      if (!first) sum.appendChild(document.createTextNode(' / '));
      first = false;
      var sp = el('span', null, counts[k[0]] + ' ' + k[0]); sp.style.color = k[1]; sum.appendChild(sp);
    });

    var meta = $('status-meta'), age = feedAgeMs();
    meta.textContent = (age === null)
      ? 'last updated: unknown'
      : 'last updated: ' + new Date(feed.updated).toLocaleString() + ' (' + fmtAge(age) + ')';
    var note = $('status-stale'); note.textContent = '';
    note.hidden = !stale;
    if (stale) {
      note.textContent = feedError
        ? 'Feed stale: the status feed could not be read (' + feedError + '). Showing unknown until it recovers.'
        : 'Feed stale: no update in over ' + fmtDuration(statusMax()) + ', so current state is unknown.';
    }
  }

  function loadFeed() {
    // cache-busting query string + no-store so CDNs and browsers never serve an old copy
    return fetch('data/status.json?t=' + Date.now(), { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (j) { feed = j; feedError = null; })
      .catch(function (e) { feedError = e.message; if (!feed) feed = null; })
      .then(renderStatus);
  }
  function loadServices() {
    return getJSON('data/services.json').then(function (j) {
      services = j.services || [];
    }).catch(function (e) {
      $('status-grid').appendChild(el('p', 'notice', 'Could not load data/services.json (' + e.message + ')'));
    });
  }
  function initStatus(cfg) {
    statusCfg = cfg || {};
    $('status-intro').textContent = statusCfg.intro || '';
    $('refresh').addEventListener('click', loadFeed);
    return loadServices().then(loadFeed).then(function () {
      clearInterval(pollTimer);
      pollTimer = setInterval(loadFeed, (statusCfg.refreshSeconds || STATUS_DEFAULTS.refreshSeconds) * 1000);
    });
  }

  /* ---------- nav ---------- */
  function initNav() {
    var toggle = $('nav-toggle'), nav = $('nav');
    toggle.addEventListener('click', function () {
      var open = nav.classList.toggle('open'); toggle.setAttribute('aria-expanded', String(open));
    });
    nav.addEventListener('click', function (e) {
      if (e.target.tagName === 'A') { nav.classList.remove('open'); toggle.setAttribute('aria-expanded', 'false'); }
    });
    var links = {};
    Array.prototype.forEach.call(nav.querySelectorAll('a[data-sec]'), function (a) { links[a.dataset.sec] = a; });
    if (!('IntersectionObserver' in window)) return;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) {
          for (var k in links) { links[k].classList.toggle('active', k === en.target.id); if (k === en.target.id) links[k].setAttribute('aria-current', 'true'); else links[k].removeAttribute('aria-current'); }
        }
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    Object.keys(links).forEach(function (k) { io.observe($(k)); });
  }

  /* ---------- init ---------- */
  initNav();
  getJSON('data/content.json').then(function (c) {
    renderHome(c); renderHardware(c.hardware || {}); renderNetwork(c.network || {}); renderProjects(c.projects || {});
    runBoot(c.boot || []);
    return initStatus(c.status);
  }).catch(function (e) {
    var main = $('main');
    var msg = el('p', 'notice', 'Could not load data files (' + e.message + '). Serve this folder over HTTP, e.g. "python3 -m http.server 8000" — opening index.html via file:// blocks fetch().');
    var w = el('div', 'wrap'); w.appendChild(msg); main.insertBefore(w, main.firstChild);
  });
})();
