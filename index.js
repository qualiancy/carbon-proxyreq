module.exports = process.env.proxyreq_COV
  ? require('./lib-cov/proxyreq')
  : require('./lib/proxyreq');
