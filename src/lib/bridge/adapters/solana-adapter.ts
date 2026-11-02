import { Connection, PublicKey, Keypair, Transaction, TransactionInstruction } from '@solana/web3.js';
import { createSolanaAdapterFromPrivateKey } from '@circle-fin/adapter-solana';
import { SolanaDevnet, Solana } from '@circle-fin/app-kit/chains';
import { CCTP_DOMAINS, MAINNET_CCTP_DOMAINS } from '../cctp-provider';
import { getSolanaRpcUrl, getSolanaFallbackRpcUrl } from '@/lib/solana-rpc';

export class SolanaAdapter {
  static async submitMint(
    destinationDomain: number,
    messageHex: string,
    attestationHex: string,
    destinationChainName?: string
  ): Promise<string> {
    const isDevnet = destinationChainName 
      ? destinationChainName.toLowerCase().includes("devnet") 
      : (process.env.SOLANA_NETWORK !== "mainnet" && process.env.SOLANA_NETWORK !== "mainnet-beta");

    const primaryRpc = getSolanaRpcUrl(!isDevnet);
    const fallbackRpc = getSolanaFallbackRpcUrl(!isDevnet);

    const privateKey = isDevnet
      ? process.env.SOL_CCTP_TEST_KEY
      : (process.env.SOLANA_MAINNET_RELAYER_KEY || process.env.SOL_CCTP_TEST_KEY);

    if (!privateKey) {
      throw new Error(`Solana relayer key (${isDevnet ? 'SOL_CCTP_TEST_KEY' : 'SOLANA_MAINNET_RELAYER_KEY'}) is not configured on server`);
    }

    let connection = new Connection(primaryRpc, 'confirmed');

    // Decode relayer keypair to inspect public key & balance
    const bs58Module = await import('bs58');
    const bs58 = (bs58Module as any).default || bs58Module;
    const relayerKeypair = Keypair.fromSecretKey(bs58.decode(privateKey));
    const relayerPubKey = relayerKeypair.publicKey.toBase58();

    // Check relayer SOL balance to prevent out-of-gas stalls
    let relayerLamports = 0;
    try {
      relayerLamports = await connection.getBalance(relayerKeypair.publicKey);
    } catch (rpcErr) {
      console.warn(`[SolanaAdapter] Primary RPC failed balance check. Switching to fallback RPC (${fallbackRpc}):`, rpcErr);
      connection = new Connection(fallbackRpc, 'confirmed');
      relayerLamports = await connection.getBalance(relayerKeypair.publicKey);
    }

    const minLamports = 2_000_000; // 0.002 SOL threshold for gas & potential ATA rent
    if (relayerLamports < minLamports) {
      throw new Error(`Solana relayer has low SOL balance (${relayerLamports / 1e9} SOL). Minimum required: 0.002 SOL. Please fund ${relayerPubKey}.`);
    }

    // Clean hex utility
    const cleanMsg = messageHex.replace(/^0x/, '');
    const cleanAtt = attestationHex.replace(/^0x/, '');
    const messageBuf = Buffer.from(cleanMsg, 'hex');

    // 1. Parse Source Domain and Nonce from CCTP Message Header
    const sourceDomainNum = messageBuf.readUInt32BE(4);
    const nonceNum = messageBuf.readBigUInt64BE(12);

    // 2. Derive 32-byte eventNonce (bytes 12 to 44 of message)
    const eventNonce = cleanMsg.slice(12 * 2, 44 * 2);

    // 3. Parse Recipient ATA (bytes 184 to 216)
    const recipientHex = cleanMsg.slice(184 * 2, 216 * 2);
    const recipientBytes = Buffer.from(recipientHex, 'hex');

    let recipientAta: PublicKey;
    let destinationAddress = "";

    if (recipientHex.startsWith("000000000000000000000000")) {
      const evmAddr = "0x" + recipientHex.slice(24);
      console.warn(`[SolanaAdapter] Warning: Recipient address in CCTP message is an EVM address (${evmAddr}) zero-padded to 32 bytes, not a Solana Base58 PublicKey.`);
      recipientAta = new PublicKey(recipientBytes);
      destinationAddress = recipientAta.toBase58();
    } else {
      recipientAta = new PublicKey(recipientBytes);
      destinationAddress = recipientAta.toBase58();
    }

    // 4. Resolve on-curve wallet owner address from ATA or inspect account
    let ataExists = false;
    try {
      const accInfo = await connection.getAccountInfo(recipientAta);
      if (accInfo && accInfo.owner.toBase58() === "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" && accInfo.data.length === 165) {
        // SPL Token account layout puts the owner public key at bytes 32-64
        const ownerBytes = accInfo.data.slice(32, 64);
        destinationAddress = new PublicKey(ownerBytes).toBase58();
        ataExists = true;
        console.log(`[SolanaAdapter] Resolved on-curve owner address ${destinationAddress} from recipient ATA.`);
      } else if (accInfo) {
        ataExists = true;
        console.log(`[SolanaAdapter] Recipient account exists on Solana: ${destinationAddress}`);
      }
    } catch (resolveErr) {
      console.warn(`[SolanaAdapter] Failed to inspect ATA status:`, resolveErr);
    }

    // Pre-flight check: ensure recipient ATA exists before minting
    if (!ataExists) {
      console.log(`[SolanaAdapter] Recipient ATA ${recipientAta.toBase58()} does not exist on Solana. Auto-creating ATA prior to mint...`);
      try {
        const usdcMint = new PublicKey(
          isDevnet ? "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU" : "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
        );
        const tokenProgramId = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
        const ataProgramId = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
        const systemProgramId = new PublicKey("11111111111111111111111111111111");

        const ownerPubKey = new PublicKey(destinationAddress);
        const createAtaIx = new TransactionInstruction({
          programId: ataProgramId,
          keys: [
            { pubkey: relayerKeypair.publicKey, isSigner: true, isWritable: true },
            { pubkey: recipientAta, isSigner: false, isWritable: true },
            { pubkey: ownerPubKey, isSigner: false, isWritable: false },
            { pubkey: usdcMint, isSigner: false, isWritable: false },
            { pubkey: systemProgramId, isSigner: false, isWritable: false },
            { pubkey: tokenProgramId, isSigner: false, isWritable: false }
          ],
          data: Buffer.from([1]) // 1 = CreateIdempotent
        });

        const latestBlockhash = await connection.getLatestBlockhash('confirmed');
        const tx = new Transaction().add(createAtaIx);
        tx.recentBlockhash = latestBlockhash.blockhash;
        tx.feePayer = relayerKeypair.publicKey;
        tx.sign(relayerKeypair);
        const ataSig = await connection.sendRawTransaction(tx.serialize());
        await connection.confirmTransaction({ signature: ataSig, ...latestBlockhash }, 'confirmed');
        console.log(`[SolanaAdapter] Successfully initialized recipient ATA. Tx: ${ataSig}`);
      } catch (ataErr) {
        console.warn(`[SolanaAdapter] Note on ATA creation:`, ataErr);
      }
    }

    // 5. Dynamic fromChain configuration based on CCTP_DOMAINS
    const allDomains = isDevnet ? CCTP_DOMAINS : MAINNET_CCTP_DOMAINS;
    let sourceChainName = "";
    for (const [name, config] of Object.entries(allDomains)) {
      if (config.domain === sourceDomainNum) {
        sourceChainName = name;
        break;
      }
    }

    if (!sourceChainName) {
      throw new Error(`Unsupported source domain: ${sourceDomainNum}`);
    }

    const sourceDomainConfig = allDomains[sourceChainName];
    const rawUsdc = sourceDomainConfig?.usdc || "";
    const cleanUsdcAddress = rawUsdc.includes("::") ? rawUsdc.split("::")[0] : rawUsdc;

    const fromChain = {
      type: sourceChainName.toLowerCase().includes("stellar") ? "stellar" : "evm",
      chain: sourceChainName.replace(/\s+/g, '_'),
      name: sourceChainName,
      usdcAddress: cleanUsdcAddress,
      cctp: {
        domain: sourceDomainNum,
        contracts: {
          v2: {
            type: "split",
            tokenMessenger: sourceDomainConfig?.tokenMessenger || "",
            messageTransmitter: sourceDomainConfig?.messageTransmitter || ""
          }
        }
      }
    };

    // 6. Create adapter
    const adapter = await createSolanaAdapterFromPrivateKey({
      privateKey,
      connection
    });

    const targetChain = isDevnet ? SolanaDevnet : Solana;

    // 7. Invoke receiveMessage action handler from Map registry
    const handler = adapter.actionRegistry.actionHandlers.get('cctp.v2.receiveMessage');
    if (!handler) {
      throw new Error("cctp.v2.receiveMessage action handler not found in Solana adapter");
    }

    const adapterAddress = await adapter.getAddress(targetChain);

    console.log(`[SolanaAdapter] Executing mint for nonce ${nonceNum.toString()} (domain ${sourceDomainNum} -> ${destinationDomain}) to recipient ${destinationAddress}...`);
    const result = await handler({
      fromChain,
      toChain: targetChain,
      eventNonce,
      destinationAddress,
      message: '0x' + cleanMsg,
      attestation: '0x' + cleanAtt
    }, {
      chain: targetChain,
      address: adapterAddress
    });

    // 8. Submit transaction and return signature
    const signature = await result.execute();
    console.log(`[SolanaAdapter] Successfully submitted mint! Signature: ${signature}`);
    return signature;
  }
}
