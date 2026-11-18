// Top up the Telegraph escrow: approve + depositUSDC on the Telegraph diamond (Sepolia). Never prints the key.
// Run: NODE_USE_ENV_PROXY=1 node --disable-warning=ExperimentalWarning scripts/deposit-escrow.mjs 1   (amount in USDC)
import { createPublicClient, createWalletClient, http, parseAbi, parseUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
const rpc = http('https://ethereum-sepolia-rpc.publicnode.com');
let k = process.env.EVM_PRIVATE_KEY; if (!k.startsWith('0x')) k = '0x' + k;
const account = privateKeyToAccount(k);
const pub = createPublicClient({ chain: sepolia, transport: rpc });
const w = createWalletClient({ account, chain: sepolia, transport: rpc });
const D = '0x72a70e949362670Bf8bceAd24eFC5b8f950aa08b', USDC = '0xcc194e1a843B658526D0D5C431f670028582Ae17';
const amt = parseUnits(process.argv[2] || '0.25', 6);
const erc = parseAbi(['function approve(address,uint256) returns (bool)', 'function allowance(address,address) view returns (uint256)', 'function balanceOf(address) view returns (uint256)']);
const led = parseAbi(['function depositUSDC(uint256)']);
if ((await pub.readContract({ address: USDC, abi: erc, functionName: 'allowance', args: [account.address, D] })) < amt) {
  const h = await w.writeContract({ address: USDC, abi: erc, functionName: 'approve', args: [D, amt] });
  await pub.waitForTransactionReceipt({ hash: h }); console.log('approve tx', h);
}
await pub.simulateContract({ account, address: D, abi: led, functionName: 'depositUSDC', args: [amt] });
const h = await w.writeContract({ address: D, abi: led, functionName: 'depositUSDC', args: [amt] });
const r = await pub.waitForTransactionReceipt({ hash: h });
console.log('deposit tx', h, r.status);
console.log('wallet USDC now', Number(await pub.readContract({ address: USDC, abi: erc, functionName: 'balanceOf', args: [account.address] })) / 1e6);
