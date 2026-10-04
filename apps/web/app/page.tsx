import BindFlow from '@/components/BindFlow';

export default function Home() {
  return (
    <main>
      <h1>
        A real, adult human <em>stands behind</em> this agent.
      </h1>
      <p className="lede">
        Prove you own and authorize an AI agent with a zero-knowledge proof over your Aadhaar Secure QR. The proof is
        bound to the agent&apos;s ERC-8004 identity. Marketplaces learn three things: unique human, 18+, accountable.
        Nothing else.
      </p>
      <BindFlow />
    </main>
  );
}
