var http = require('http')
var engine = require('engine.io');
var eic = require('engine.io-client');

describe.only('ws', function () {
  var server1 = http.createServer()
    , ws1 = engine.attach(server1);

  var server2 = http.createServer();
  server2.on('upgrade', function (req, sock, head) {
    var proxy = new ProxyRequest(req, sock);
    proxy.proxyWS({ host: 'localhost', port: 6786, head: head });
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

  describe('connection', function () {
    it('should work', function (done) {
      ws1.on('connection', function (sock) {
        sock.on('message', function (input) {
          input.should.equal('ping');
          sock.send('pong');
        });
      });

      var client = eic('ws://localhost:6785', { transports: [ 'websocket' ] });

      client.onopen = function() {
        client.send('ping');

        client.onmessage = function(msg) {
          msg.toString().should.equal('pong');
          client.close();
        };

        client.onclose = function() {
          done();
        };
      };
    });
  });
});
