// Shows the burner wallet address + Sepolia balances, and tries to mint test USDC.
// Usage: node scripts/setup-wallet.mjs [amount]   (amount given = always mint that much)
// Reads EVM_PRIVATE_KEY from env. NEVER prints the key.
import { createPublicClient, createWalletClient, http, formatEther, formatUnits, parseUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';

const USDC = process.env.USDC_ADDRESS || '0xcc194e1a843B658526D0D5C431f670028582Ae17';
const MINT_AMOUNT = process.argv[2] || '10'; // USDC to mint
const rpc = process.env.SEPOLIA_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com';

let key = process.env.EVM_PRIVATE_KEY;
if (!key) { console.error('EVM_PRIVATE_KEY is not set (use a burner testnet wallet).'); process.exit(1); }
if (!key.startsWith('0x')) key = '0x' + key;

const account = privateKeyToAccount(key);
const pub = createPublicClient({ chain: sepolia, transport: http(rpc) });
const wallet = createWalletClient({ account, chain: sepolia, transport: http(rpc) });

const abi = [
  { name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'a', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { name: 'decimals', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
  { name: 'mint', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [] },
];

async function show() {
  const eth = await pub.getBalance({ address: account.address });
  const usdc = await pub.readContract({ address: USDC, abi, functionName: 'balanceOf', args: [account.address] });
  const dec = await pub.readContract({ address: USDC, abi, functionName: 'decimals' });
  console.log(`Wallet:       ${account.address}`);
  console.log(`Sepolia ETH:  ${formatEther(eth)}`);
  console.log(`Test USDC:    ${formatUnits(usdc, dec)}`);
  return { eth, usdc, dec };
}

let s = await show();
if (s.eth === 0n) {
  console.error('\nNo Sepolia ETH. Fund this address from a Sepolia faucet, then re-run.');
  process.exit(2);
}
const explicit = process.argv[2] !== undefined; // `setup-wallet.mjs 20` always mints 20; with no argument it only tops up when below 1 USDC
if (explicit || s.usdc < parseUnits('1', s.dec)) {
  console.log(`\nTrying to mint ${MINT_AMOUNT} test USDC...`);
  try {
    const hash = await wallet.writeContract({ address: USDC, abi, functionName: 'mint', args: [account.address, parseUnits(MINT_AMOUNT, s.dec)] });
    await pub.waitForTransactionReceipt({ hash });
    console.log('Mint tx:', hash);
    await show();
  } catch (e) {
    console.error('Mint failed:', (e.shortMessage || e.message || '').split('\n')[0]);
    console.error('Get test USDC from the Circle faucet (faucet.circle.com, Ethereum Sepolia) to the address above.');
    process.exit(3);
  }
}
