import 'dotenv/config'
import { ethers } from 'ethers'
import pkg from 'pg'
const { Pool } = pkg

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const provider = new ethers.JsonRpcProvider(process.env.AMOY_RPC_URL || 'https://rpc-amoy.polygon.technology/')
const wallet = process.env.MINTING_PRIVATE_KEY ? new ethers.Wallet(process.env.MINTING_PRIVATE_KEY, provider) : null

const erc20 = [
  "function transfer(address to, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)"
]
const TOKEN = process.env.MC_TOKEN_ADDRESS || ''

async function tick(){
  const { rows } = await pool.query(`select id,email,amount_usd,wallet_address from mints where status='queued' order by id asc limit 10`)
  if(!rows.length) return
  for(const r of rows){
    try{
      if(!wallet || !TOKEN || !r.wallet_address){
        await pool.query(`update mints set status='needs_attention', note='missing wallet/token' where id=$1`, [r.id])
        continue
      }
      const c = new (await import('ethers')).Contract(TOKEN, erc20, wallet)
      const dec = await c.decimals()
      const amt = BigInt(Math.floor(Number(r.amount_usd) * 0.5)) * (10n ** BigInt(dec))
      const tx = await c.transfer(r.wallet_address, amt)
      await tx.wait()
      await pool.query(`update mints set status='minted', tx_hash=$2 where id=$1`, [r.id, tx.hash])
    }catch(e){
      await pool.query(`update mints set status='failed', note=$2 where id=$1`, [r.id, e.message])
    }
  }
}

setInterval(tick, 15000)
