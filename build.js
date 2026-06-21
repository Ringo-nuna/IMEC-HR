const fs = require('fs');
const path = require('path');

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_KEY;

if (!url || !key) {
  console.error('ERROR: SUPABASE_URL 또는 SUPABASE_KEY 환경변수가 설정되지 않았습니다.');
  process.exit(1);
}

const src = path.join(__dirname, 'outputs', 'imec-hr.html');
const outDir = path.join(__dirname, 'dist');
const out = path.join(outDir, 'index.html');

let html = fs.readFileSync(src, 'utf8');
html = html.replaceAll('__SUPABASE_URL__', url);
html = html.replaceAll('__SUPABASE_KEY__', key);

fs.mkdirSync(outDir, { recursive: true });

// 로고 이미지 복사
const logoSrc = path.join(__dirname, 'deploy', 'imec-logo.png');
if (fs.existsSync(logoSrc)) {
  fs.copyFileSync(logoSrc, path.join(outDir, 'imec-logo.png'));
}

fs.writeFileSync(out, html, 'utf8');
console.log('빌드 완료: dist/index.html');
