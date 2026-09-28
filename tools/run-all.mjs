/* Прогон всех сетевых тестов подряд. */
import { spawn } from 'node:child_process';
const list = ['test-rooms','test-race','test-dvoeplay','test-matreshka','test-magnit','test-dots',
              'test-memo','test-5bukv','test-yaschik','test-viselica','test-dobble','test-vzlomshik','test-names','test-theme','test-hero','test-pair','test-tour','test-keyboard','test-layout','test-app','test-lost','test-soak'];
const bad = [];
for (const t of list){
  const code = await new Promise(r => {
    const p = spawn('node', ['tools/' + t + '.mjs'], { cwd: '/home/claude/net', stdio: ['ignore','pipe','pipe'] });
    let out = '';
    p.stdout.on('data', d => { out += d; });
    p.stderr.on('data', d => { out += d; });
    p.on('close', c => {
      const tail = out.trim().split('\n').slice(-1)[0];
      const bads = out.split('\n').filter(l => l.includes('ПЛОХО') || l.includes('ОШИБКА В СТРАНИЦЕ'));
      console.log((c === 0 ? '  ✓ ' : '  ✗ ') + tail);
      bads.forEach(l => console.log('      ' + l.trim()));
      r(c);
    });
  });
  if (code !== 0) bad.push(t);
}
/* «все 22 проверки прошли», «все 21 проверка прошла», «все 25 проверок прошли» */
const done = (n) => (n % 10 === 1 && n % 100 !== 11) ? 'проверка прошла'
  : (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) ? 'проверки прошли' : 'проверок прошли';
console.log(bad.length ? '\nне прошли: ' + bad.join(', ') : '\nвсе ' + list.length + ' ' + done(list.length));
process.exit(bad.length ? 1 : 0);
