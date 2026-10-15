"""Визуальный смоук новых возможностей E3: tiles/tileMap/node/phys/sprite/particles.

Собирает страницу с одним кадром и сохраняет PNG. Только для ручной проверки,
в гейты не входит.
"""
import importlib.util, os, re, sys, tempfile
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
# Путь к run-tests считаем от этого файла: проект переехал в Work AI.
spec = importlib.util.spec_from_file_location("rt", os.path.join(HERE, "run-tests.py"))
R = importlib.util.module_from_spec(spec)
spec.loader.exec_module(R)

scene = """
<script>
try{ requestAnimationFrame(function () {
 try {
  var ts = document.getElementById('titleScreen');
  if (ts) ts.style.display = 'none';
  var cv = document.createElement('canvas');
  cv.width = 900; cv.height = 560; cv._lw = 900; cv._lh = 560;
  cv.style.cssText = 'position:fixed;left:0;top:0;z-index:99999';
  document.body.appendChild(cv);
  var ctx = cv.getContext('2d');
  var cam = { x: 0, y: 7, z: -16, yaw: 0, pitch: .34 };
  var fl = 450 / Math.tan(.5);
  var L = [.42, .75, .5], f = [], log = [];

  function group(name, faces) {
    try {
      E3.draw(ctx, faces, cam, fl, L, { spec: .35, shin: 20 });
      log.push(name + '=ok(' + faces.length + ')');
    } catch (e) {
      log.push(name + '=FAIL ' + e.message);
    }
    f = f.concat(faces);
  }

  /* E-8: пол одним объектом */
  group('tiles', E3.tiles(30, 30, { y: 0, c: '#2e7d4f' }));

  /* E-14: сетка плиток — шахматный газон */
  group('tileMap', E3.tileMap(10, 10, 3, 3, function (gx, gz) {
    return (gx + gz) % 2 ? '#3f9c63' : '#2b7a4a';
  }, { y: .01 }));

  /* E-13: физика — два мяча */
  var a = E3.phys.o(), b = E3.phys.o();
  a.x = -3; a.y = 1.4; a.z = 2; a.vx = 2; a.r = .45;
  b.x = 1; b.y = 2.6; b.z = 2; b.vy = 0; b.r = .45;
  for (var i = 0; i < 90; i++) {
    E3.phys.step(a, 1 / 60, { g: 9.8 });
    E3.phys.step(b, 1 / 60, { g: 9.8 });
    E3.phys.hit(a, b, .92);
  }
  function ball(o, col) {
    var g = E3.pyramid(0, 0, 0, o.r * 2, o.r * 2, o.r * 2, col);
    return g.map(function (face) {
      return { v: face.v.map(function (q) { return [q[0] + o.x, q[1] + o.y - o.r, q[2] + o.z]; }),
               c: face.c, n: face.n, s: 1 };
    });
  }
  group('phys', ball(a, '#e04f4f').concat(ball(b, '#4f7fe0')));

  /* E-11: node — башня из кубиков с поворотами */
  var tower = [];
  tower = tower.concat(E3.node({ x: 7, y: 0, z: 3, ry: .5 }).box(1.6, .8, 1.6, '#c8a24a'));
  tower = tower.concat(E3.node({ x: 7, y: 1.6, z: 3, ry: .5, s: .8 }).box(1.6, .8, 1.6, '#a8863a'));
  tower = tower.concat(E3.node({ x: 7, y: 2.9, z: 3, ry: -1.1, s: .5 }).box(1.6, .8, 1.6, '#8f6f2e'));
  group('node', tower);

  /* E-9: текстура-паттерн */
  var pat = E3.pattern(ctx, 'checker', '#ffffff', '#dddddd');
  group('pattern', E3.box(-7, .2, -3, 4, .4, 4, pat || '#ffffff'));

  /* E-10: частицы (снег) */
  var ps = E3.particles(90, { txt: '❄', c: '#eaf4ff', w: 26, h: 12, d: 26, spd: 1.2, s: .35, glow: 0 });
  for (var k = 0; k < 40; k++) ps.step(1 / 60);
  group('particles', ps.faces());

  /* E-7: спрайты-подписи + эмодзи-объекты */
  group('sprites', [E3.sprite(0, 4.2, 2, .5, '❄', '#ffffff'),
                    E3.sprite(3, 2.2, -2, .7, '🌲', '#2f7d4f'),
                    E3.sprite(-4, 2.2, -2, .7, '🌲', '#2f7d4f')]);

  /* E-4: тень */
  group('shadow', E3.shadow(0, 0, 1.2, 0, { a: .3 }).concat(E3.shadow(7, 0, 1.6, 0, { a: .3 })));

  document.title = 'ГРУППЫ ' + log.join(' | ') + ' || СТАТИСТИКА faces=' +
    E3.stats.faces + ' culled=' + E3.stats.culled +
    ' dropped=' + E3.stats.dropped + ' total=' + E3.stats.total +
    ' tiles=' + E3.stats.tiles;
  window.__ready = true;
 } catch (err) { document.title = 'ОШИБКА ' + err + ' @@ ' + String(err.stack).slice(0, 300); }
}); }catch(err){ document.title='ОШИБКА '+err; }
</script>
"""

tmp = tempfile.mkdtemp(prefix="e3shot_")
profile = tempfile.mkdtemp(prefix="nbprof_")
path, _ = R.make_page(tmp, "", scene)
out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "_shots_v2", "e3_showcase.png")
chrome = R.find_chrome()
cmd = [chrome, "--headless=new", "--disable-gpu", "--no-sandbox",
       "--user-data-dir=" + profile, "--hide-scrollbars",
       "--virtual-time-budget=6000", "--allow-file-access-from-files",
       "--window-size=1000,700", "--screenshot=" + out, "--dump-dom",
       "file:///" + path.replace("\\", "/")]
import subprocess
res = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
dom = res.stdout
err = [l for l in res.stderr.splitlines()
       if "ERROR" in l or "Uncaught" in l or "SEVERE" in l or "__e3" in l]
print("ошибки консоли:", err[:8] if err else "нет")
print("моя сцена нарисована:", "моя сцена нарисована" in dom or 'z-index:99999' in dom)
m = re.search(r"<title>(.*?)</title>", dom, re.S)
print("статистика кадра:", (m.group(1).strip() if m else dom[:400]))
print("PNG:", out, os.path.getsize(out) if os.path.exists(out) else "НЕ СОЗДАН")

