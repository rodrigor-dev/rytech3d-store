const http = require('http');
const querystring = require('querystring');

const loginData = querystring.stringify({ username: 'admin', password: 'Rytech3d@2026' });

const req = http.request({
  hostname: 'localhost',
  port: 3000,
  path: '/admin/login',
  method: 'POST',
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded',
    'Content-Length': Buffer.byteLength(loginData)
  }
}, (res) => {
  const cookies = res.headers['set-cookie'];
  console.log('Login status:', res.statusCode);

  if (cookies && cookies.length > 0) {
    const adminToken = cookies[0].split(';')[0];
    console.log('Got admin token');

    const saveData = querystring.stringify({
      id: '',
      name: 'Teste URL Imagem',
      description: 'Testando salvamento de URL de imagem',
      price: '29.90',
      delivery_time: '3 dias',
      category: 'Teste',
      image_url_input: 'https://i.ibb.co/KxYxNfR/test-image.jpg',
      featured: '1',
      active: '1'
    });

    const req2 = http.request({
      hostname: 'localhost',
      port: 3000,
      path: '/admin/products/save',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(saveData),
        'Cookie': adminToken
      }
    }, (res2) => {
      console.log('Save status:', res2.statusCode);
      console.log('Redirect to:', res2.headers.location);

      let body = '';
      res2.on('data', chunk => body += chunk);
      res2.on('end', () => {
        console.log('Response body (first 300 chars):', body.substring(0, 300));

        const { initDatabase, prepare } = require('./database');
        initDatabase().then(async () => {
          const products = await prepare("SELECT id, name, image_url FROM products ORDER BY id DESC LIMIT 5").all();
          console.log('\nRecent products:');
          products.forEach(p => console.log('  -', p.id, p.name, '->', p.image_url));
          process.exit(0);
        });
      });
    });
    req2.on('error', e => { console.error('Save error:', e.message); process.exit(1); });
    req2.write(saveData);
    req2.end();
  }
});
req.on('error', (e) => console.error('Error:', e.message));
req.write(loginData);
req.end();
