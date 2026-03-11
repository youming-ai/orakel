#!/usr/bin/env node

const https = require('https');
const http = require('http');
const { performance } = require('perf_hooks');

const POLYMARKET_API = 'https://clob.polymarket.com';
const CHAINLINK_RPC = 'https://mainnet.chain.list';

async function measureRequest(url, options = {}) {
  return new Promise((resolve) => {
    const start = performance.now();
    const protocol = url.startsWith('https') ? https : http;
    
    const req = protocol.get(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const end = performance.now();
        resolve({
          statusCode: res.statusCode,
          latency: (end - start).toFixed(2),
          success: res.statusCode >= 200 && res.statusCode < 400
        });
      });
    });
    
    req.on('error', (err) => {
      const end = performance.now();
      resolve({
        statusCode: null,
        latency: (end - start).toFixed(2),
        success: false,
        error: err.message
      });
    });
    
    req.setTimeout(10000, () => {
      req.destroy();
      resolve({
        statusCode: null,
        latency: null,
        success: false,
        error: 'Timeout'
      });
    });
  });
}

async function testPolymarketAPI() {
  console.log('\n=== Polymarket Client API Test ===\n');
  
  const endpoints = [
    { name: 'Markets', url: `${POLYMARKET_API}/markets?limit=1` },
    { name: 'Markets Info', url: `${POLYMARKET_API}/markets?active=true&limit=1` },
  ];
  
  for (const endpoint of endpoints) {
    console.log(`Testing: ${endpoint.name}`);
    console.log(`  URL: ${endpoint.url}`);
    const result = await measureRequest(endpoint.url);
    console.log(`  Status: ${result.statusCode || 'N/A'}`);
    console.log(`  Latency: ${result.latency ? result.latency + 'ms' : 'Failed'}`);
    console.log(`  Success: ${result.success ? '✓' : '✗'}`);
    if (result.error) console.log(`  Error: ${result.error}`);
    console.log('');
  }
}

async function testPolymarketSDK() {
  console.log('=== Polymarket SDK Test ===\n');
  
  try {
    const { Polymarket } = require('@polymarket/client');
    const client = new Polymarket();
    
    console.log('Testing SDK: fetchMarkets()');
    const start = performance.now();
    const markets = await client.fetchMarkets({ limit: 1 });
    const end = performance.now();
    
    console.log(`  Latency: ${(end - start).toFixed(2)}ms`);
    console.log(`  Success: ✓`);
    console.log(`  Markets fetched: ${markets?.length || 0}`);
  } catch (err) {
    console.log(`  SDK Test: ✗ Failed`);
    console.log(`  Error: ${err.message}`);
    console.log(`  Note: Install with: npm install @polymarket/client`);
  }
  console.log('');
}

async function testChainlinkLatency() {
  console.log('=== Chainlink Network Latency Test ===\n');
  
  const rpcEndpoints = [
    { name: 'Ethereum Mainnet', url: 'https://eth.llamarpc.com' },
    { name: 'Ethereum Holesky (Chainlink)', url: 'https://rpc.holesky.ethereum.org' },
  ];
  
  for (const endpoint of rpcEndpoints) {
    console.log(`Testing: ${endpoint.name}`);
    console.log(`  URL: ${endpoint.url}`);
    
    try {
      const result = await measureRequest(endpoint.url);
      console.log(`  Status: ${result.statusCode || 'N/A'}`);
      console.log(`  Latency: ${result.latency ? result.latency + 'ms' : 'Failed'}`);
      console.log(`  Success: ${result.success ? '✓' : '✗'}`);
      if (result.error) console.log(`  Error: ${result.error}`);
    } catch (err) {
      console.log(`  Error: ${err.message}`);
    }
    console.log('');
  }
  
  console.log('Testing JSON-RPC call to Chainlink (eth_blockNumber):\n');
  
  const payload = {
    jsonrpc: '2.0',
    method: 'eth_blockNumber',
    params: [],
    id: 1
  };
  
  const data = JSON.stringify(payload);
  const options = {
    hostname: 'eth.llamarpc.com',
    port: 443,
    path: '/',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': data.length
    }
  };
  
  const start = performance.now();
  
  return new Promise((resolve) => {
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        const end = performance.now();
        const latency = (end - start).toFixed(2);
        
        console.log(`  RPC Method: eth_blockNumber`);
        console.log(`  Status: ${res.statusCode}`);
        console.log(`  Latency: ${latency}ms`);
        console.log(`  Success: ${res.statusCode === 200 ? '✓' : '✗'}`);
        
        try {
          const parsed = JSON.parse(body);
          if (parsed.result) {
            console.log(`  Block Number: ${parsed.result}`);
          }
        } catch (e) {}
        
        console.log('');
        resolve();
      });
    });
    
    req.on('error', (err) => {
      console.log(`  Error: ${err.message}`);
      console.log('');
      resolve();
    });
    
    req.write(data);
    req.end();
  });
}

async function main() {
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║     Polymarket & Chainlink Connectivity Test Script      ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');
  
  await testPolymarketAPI();
  await testPolymarketSDK();
  await testChainlinkLatency();
  
  console.log('=== Test Complete ===');
}

main().catch(console.error);