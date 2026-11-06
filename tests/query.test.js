const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Q = require('../src/public/assets/query.js');
const service = 'urlscanify';
const catalog = JSON.parse(fs.readFileSync(path.join(__dirname,'../src/lib/catalog.json'), 'utf8'));
const full = {hostname:'example.com',net:'203.0.113.0/24',org:service === 'githubify' ? 'example-org' : 'Example Organisation',asn:'AS64496',domain:'example.com',repo:'example-org/example-project',term:'deployment',ip:'203.0.113.10',title:'Example Organisation'};
const filters = {port:'443',product:'nginx',language:'Python',days:'30',hash:'0'.repeat(64)};
test('all catalog templates resolve and stay on the intended search service', () => {
  for (const category of catalog.categories) for (const template of category.templates) {
    const result = Q.resolve(service, template.query, full, filters);
    assert.deepEqual(result.missing, [], template.title);
    assert.ok(!/[{}‹›]/.test(result.query), template.title);
    const url = new URL(Q.searchUrl(service, result.query, template.mode));
    assert.equal(url.protocol, 'https:');
    assert.equal(url.hostname, {shodanify:'www.shodan.io',githubify:'github.com',urlscanify:'urlscan.io'}[service]);
    const decoded = service === 'urlscanify' ? decodeURIComponent(url.hash.slice(1)) : url.searchParams.get(service === 'shodanify' ? 'query' : 'q');
    assert.equal(decoded, result.query);
  }
});
test('empty scope leaves required placeholders incomplete', () => {
  for (const category of catalog.categories) for (const template of category.templates) {
    assert.ok(Q.resolve(service, template.query, {}, {}).missing.length, template.title);
  }
});
test('domains normalize without accepting credentials or query injection', () => {
  assert.equal(Q.domain('https://Example.COM/path?x=1'), 'example.com');
  assert.equal(Q.domain('*.example.com.'), 'example.com');
  for (const value of ['example.com OR other.test','https://user:pass@example.com','javascript:alert(1)','example..com']) {
    assert.throws(() => Q.domain(value));
  }
});
test('quoted values cannot add unquoted search qualifiers', () => {
  const value = 'Example" OR "other';
  const key = service === 'githubify' ? 'term' : service === 'urlscanify' ? 'title' : 'org';
  const result = Q.resolve(service, `{${key}}`, {[key]:value});
  assert.equal(result.query, 'Example\\" OR \\"other');
});
test('IP, ASN, CIDR and numeric filters reject malformed values', () => {
  const invalid = Q.context(service, {ip:'999.1.2.3',asn:'ASno',net:'203.0.113.0/99'}, {port:'65536',days:'0',hash:'not-a-hash'});
  for (const key of ['ip','asn','net','port','days','hash']) assert.ok(invalid.errors[key], key);
  const valid = Q.context(service, {ip:'2001:db8::1',asn:'64496',net:'2001:db8::/32'});
  assert.deepEqual(valid.errors, {}); assert.equal(valid.values.asn, 'AS64496');
});

test('domain relationship modes generate distinct queries', () => {
  assert.equal(Q.build(service,{domain:'example.com'},{domain_mode:'page',days:'30'}).query,'page.domain:example.com AND date:>now-30d');
  assert.equal(Q.build(service,{domain:'example.com'},{domain_mode:'task',days:'30'}).query,'task.domain:example.com AND date:>now-30d');
  assert.equal(Q.build(service,{domain:'example.com'},{domain_mode:'thirdparty',days:'7'}).query,'domain:example.com AND NOT page.domain:example.com AND date:>now-7d');
});
test('lookback alone does not produce a broad query', () => {
  assert.equal(Q.build(service,{}, {days:'30'}).query,'');
});
test('redirect values and IPv6 literals are escaped', () => {
  assert.equal(Q.build(service,{ip:'2001:db8::1'},{redirect:'off-domain'}).query,'page.ip:"2001:db8::1" AND page.redirected:"off-domain"');
  assert.equal(Q.resolve(service,'page.ip:{ip}',{ip:'2001:db8::1'}).query,'page.ip:2001\\:db8\\:\\:1');
});

test('global mode removes target scope but keeps useful criteria', () => {
  const raw = {hostname:'example.com',net:'203.0.113.0/24',org:'example-org',asn:'AS64496',repo:'example-org/example-project',domain:'example.com',ip:'203.0.113.10'};
  const extra = service === 'shodanify' ? {port:'443',product:'nginx'} : service === 'githubify' ? {path:'*.yml'} : {days:'30'};
  const result = Q.build(service,raw,{...extra,global:true},service === 'githubify' ? 'code' : 'search');
  assert.deepEqual(result.errors,{});
  assert.ok(!result.query.includes('example.com') && !result.query.includes('example-org') && !result.query.includes('203.0.113') && !result.query.includes('AS64496'));
  const expected = {shodanify:'port:443 product:"nginx"',githubify:'path:*.yml',urlscanify:'date:>now-30d'};
  assert.equal(result.query,expected[service]);
});
test('global templates have no target placeholders or broken conjunctions', () => {
  for (const category of catalog.categories) for (const template of category.templates) {
    if (!template.global_query) continue;
    assert.ok(!/\{(?:hostname|net|org|asn|repo|domain|ip)\}/.test(template.global_query),template.title);
    assert.ok(!/^(AND|OR)\b|\b(AND|OR)$|\bAND\s+AND\b/.test(template.global_query),template.title);
    assert.deepEqual(Q.resolve(service,template.global_query,full,filters).missing,[],template.title);
  }
});
