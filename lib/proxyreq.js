/*!
 * Module dependencies
 */

var debug = require('sherlock')('carbon-proxyreq')
  , domain = require('domain')
  , EventEmitter = require('events').EventEmitter
  , extend = require('tea-extend')
  , http = require('http')
  , https = require('https')
  , inherits = require('util').inherits;

/*!
 * Primary export
 */

module.exports = Request;

/**
 * Request
 *
 * @param {http.Request} request
 * @param {http.Response} response
 * @api public
 */

function Request (req, res) {
  EventEmitter.call(this);
  this.req = req;
  this.res = res;
}

/*!
 * Inherit from EventEmitter
 */

inherits(Request, EventEmitter);

/**
 * proxyHTTP (opts, cb)
 *
 * @param {Object} options
 * @param {Function} callback
 * @api public
 */

Request.prototype.proxyHTTP = function (opts, cb) {
  var self = this
    , make = opts.secure ? https : http
    , out = outgoing(this.req, opts, 'http')
    , proxd = domain.create()
    , req = this.req
    , res = this.res
    , proxy;

  // Handle for when a proxy request has been completed.
  function closeloop (err) {
    proxd.remove(req);
    proxd.remove(res);

    if (err) {
      debug('(http) error: %s - %s:%d', err.message, out.host, out.port);
      self.emit('error', err, out);
      if (cb) return cb(err);
      writeError(req, res, err);
    } else {
      debug('(http) end: %s %s:%d %s', out.method, out.host, out.port, out.path);
      self.emit('end', out);
      if (cb) return cb(null);
    }
  }

  // Handle any error that occurs in the `proxd` domain.
  proxd.on('error', closeloop);
  proxd.add(req);
  proxd.add(res);

  // Make the outgoing request and pipe to original response.
  proxd.run(function () {
    debug('(http) start: %s %s:%d %s', out.method, out.host, out.port, out.path);
    self.emit('start', out);
    proxy = make.request(out)

    proxy.on('request', function (pres) {
      if (pres.headers.connection && req.headers.connection) {
        pres.headers.connection = req.headers.connection;
      } else if (pres.headers.connection) {
        pres.headers.connection = 'close';
      }

      res.writeHead(pres.statusCode, pres.headers);
      pres.on('end', closeloop);
      pres.pipe(res);
    });

    req.on('close', function () {
      debug('(http) request: close');
      proxy.abort();
    });

    req.pipe(proxy);
  });
};

Request.prototype.proxyWS = function (opts, cb) {
  var self = this
    , make = opts.secure ? https : http
    , out = outgoing(this.req, opts, 'ws')
    , proxd = domain.create()
    , req = this.req
    , socket = this.res
    , proxy;

  var head = new Buffer(opts.head.length);
  opts.head.copy(head);

  function closeloop (err) {
    debug('(ws) closeloop', err);
    proxy.close();
    socket.close();
    throw err;
  }

  proxd.on('error', closeloop);
  proxd.add(req);
  proxd.add(socket);

  proxd.run(function () {
    proxy = make.request(out);
    proxy.handshake = { headers: {}, statusCode: null };

    proxy.on('upgrade', function (preq, psock, phead) {
      debug('(ws) upgrade');
      proxy.handshake.headers = preq.headers;
      proxy.handshake.statusCode = preq.statusCode;

      psock.on('readable', function() {
        var data = psock.read();
        console.log('psock', data);
        socket.write(data);
      });

      socket.on('readable', function() {
        var data = socket.read();
        console.log('socket', data);
        psock.write(data);
      });

      //psock.pipe(socket).pipe(psock);
      //socket.pipe(psock);
      socket.on('close', psock.end.bind(psock));
      psock.on('close', socket.end.bind(socket));
    });

    proxy.once('socket', function (sock) {
      debug('(ws) socket');

      // hixie-76 requires handshake data re-written as string
      sock.on('readable', function handshake() {
        debug('(ws) handshake readable');
        var data = sock.read();
        var headers = '';
        var statusCode = proxy.handshake.statuscode;
        var str = data.toString();

        if (statusCode && 101 === statusCode) {
          headers = [
              'HTTP/1.1 101 Switching Protocols'
            , 'Upgrade: websocket'
            , 'Connection: Upgrade'
            , 'Sec-WebSocket-Accept: ' + proxy.handshake.headers['sec-websocket-accept']
          ].concat('', '').join('\r\n');
        }

        str = str.substr(0, str.search('\r\n\r\n'));
        data = data.slice(Buffer.byteLength(str), data.length);

        socket.write(headers + str);
        socket.write(data);
        sock.removeListener('readable', handshake);
      });
    });

    proxy.write(head);
    if (head && head.length == 0) {
      proxy._send('');
    }
  });
};

/*!
 * Construct the outgoing http/ws request options.
 *
 * @param {http.Request} request
 * @param {Object} original options
 * @param {String} protocol (`http` or `ws`)
 * @return {Object} outgoing options
 * @api private
 */

function outgoing (req, opts, protocol) {
  var out = {};

  // basic request destination
  out.host = opts.host;
  out.port = opts.port;
  out.method = req.method;
  out.path = req.url;
  out.headers = headers(req, protocol);

  // only use agent for http requests
  if ('http' == protocol) {
    out.agent = opts.secure
      ? new https.Agent({ host: opts.host, port: opts.port })
      : new http.Agent({ host: opts.host, port: opts.port });
  }

  return out;
}

/*!
 * Construct the outgoing request headers.
 *
 * @param {http.Request} request
 * @param {String} protocol (`http` or `ws`)
 * @return {Object} headers
 * @api private
 */

function headers (req, protocol) {
  var head = extend({}, req.headers)
    , xff, xfp, xfr;

  // bail if connection closed
  if (!req.connection && !req.socket) {
    debug('(%s) headers: no connection');
    return head;
  }

  // get new value
  xff = req.connection.remoteAddress || req.socket.remoteAddress
  xfp = req.connection.remotePort || req.socket.remotePort
  xfr = req.connection.pair ? protocol + 's' : protocol;

  // append to existing
  if (head['x-forwarded-for']) xff = head['x-forwarded-for'] + ',' + xff;
  if (head['x-forwarded-port']) xfp = head['x-forwarded-port'] + ',' + xfp;
  if (head['x-forwarded-proto']) xfr = head['x-forwarded-proto'] + ',' + xfr;

  // set to header
  head['x-forwarded-for'] = xff;
  head['x-forwarded-port'] = xfp;
  head['x-forwarded-proto'] = xfr;

  return head;
}

/*!
 * Write a 500 error if the user has decided not
 * to handle it on their own.
 *
 * @param {http.Request} request
 * @param {http.Response} response
 * @param {Error} error
 * @api private
 */

function writeError (req, res, err) {
  try {
    res.writeHead(500, { 'content-type': 'text/plain' });
    if (req.method !== 'HEAD') res.write('500 error');
    res.end();
  } catch (ex) {}
}
