var http = require('http');

describe('http', function () {
  var server1 = http.createServer(function (req, res) {
    switch (req.method) {
      case 'GET':
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.write('Hello Universe');
        res.end();
        break;
      case 'POST':
        var buf = [];

        req.on('readable', function () {
          var chunk = req.read();
          buf.push(chunk.toString());
        });

        req.on('end', function () {
          buf = buf.join('');
          try {
            req.body = JSON.parse(buf);
          } catch (ex) {
            res.statusCode = 400;
            return res.end();
          }

          res.writeHead(200, { 'content-type': 'application/json' });
          res.write(JSON.stringify(req.body));
          res.end();
        });

        break;
      case 'HEAD':
        res.writeHead(200, { 'x-token-valid': 1 });
        res.end();
      default:
        res.statusCode = 501;
        res.end();
        break;
    }
  });

  var server2 = http.createServer(function (req, res) {
    var proxy = new ProxyRequest(req, res);
    proxy.proxyHTTP({ host: 'localhost', port: 6786 });
  });

  before(function (done) {
    var next = chai.after(2, done);
    server1.listen(6786, next);
    server2.listen(6785, next);
  });

  after(function (done) {
    var next = chai.after(2, done);
    server1.on('close', next);
    server2.on('close', next);
    server1.close();
    server2.close();
  });

  describe('GET', function () {
    it('should be proxied to server', function (done) {
      chai
      .request('localhost:6785')
      .get('/')
      .res(function (res) {
        res.should.have.status(200);
        res.should.be.text;
        res.text.should.equal('Hello Universe');
        done();
      });
    });
  });

  describe('POST', function () {
    it('should be proxied to server', function (done) {
      var json = { hello: 'universe' };

      chai
      .request('localhost:6785')
      .post('/')
      .req(function (req) {
        req.send(json);
      })
      .res(function (res) {
        res.should.have.status(200);
        res.should.be.json;
        res.body.should.deep.equal(json);
        done();
      });
    });
  });

  describe('HEAD', function () {
    it('should be proxied to server', function (done) {
      chai
      .request('localhost:6785')
      .head('/')
      .res(function (res) {
        res.should.have.status(200);
        res.should.have.header('x-token-valid', 1);
        done();
      });
    });
  });
});
