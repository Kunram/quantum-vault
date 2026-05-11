import { useState, useCallback, useMemo, useEffect } from 'react';
import { PublicKey } from '@solana/web3.js';
import {
  generateKeyPair,
  loadKeyPair,
  signWithdrawal,
  verifyWithdrawal,
  getAlgorithmInfo,
  calculateSecurityScore,
  lamportsToSol,
  type PQCKeyPair,
  type VaultWithdrawalAuth,
} from './pqc';
import {
  buildInitializeVaultIx,
  buildDepositIx,
  buildWithdrawIx,
  buildEmergencyLockIx,
  buildUnlockVaultIx,
  sendTransaction,
  fetchVaultData,
  getBalance,
} from './solana';

type Tab = 'dashboard' | 'vault' | 'withdraw' | 'info';

interface VaultState {
  initialized: boolean;
  balance: number;
  totalDeposited: number;
  totalWithdrawn: number;
  depositCount: number;
  withdrawalCount: number;
  isLocked: boolean;
  createdAt: number;
  history: HistoryEntry[];
}

interface HistoryEntry {
  type: 'deposit' | 'withdraw' | 'lock' | 'unlock' | 'init';
  amount?: number;
  timestamp: number;
  pqcVerified?: boolean;
}

const LAMPORTS_PER_SOL = 1_000_000_000;

function App() {
  const [activeTab, setActiveTab] = useState<Tab>('dashboard');
  const [keyPair, setKeyPair] = useState<PQCKeyPair | null>(null);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [recipientAddr, setRecipientAddr] = useState('');
  const [depositAmount, setDepositAmount] = useState('');
  const [lastWithdrawalAuth, setLastWithdrawalAuth] = useState<VaultWithdrawalAuth | null>(null);
  const [withdrawVerified, setWithdrawVerified] = useState<{valid: boolean; details: string} | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [lastTxId, setLastTxId] = useState<string | null>(null);
  const [walletBalance, setWalletBalance] = useState<number>(0);

  type StepStatus = 'pending' | 'active' | 'done' | 'error';
  interface SignStep { label: string; detail: string; status: StepStatus; icon: string; time?: number; }
  const [signSteps, setSignSteps] = useState<SignStep[]>([]);
  const [showPipeline, setShowPipeline] = useState(false);

  const updateStep = (index: number, updates: Partial<SignStep>) => {
    setSignSteps(prev => prev.map((s, i) => i === index ? { ...s, ...updates } : s));
  };

  const [vault, setVault] = useState<VaultState>({
    initialized: false, balance: 0, totalDeposited: 0, totalWithdrawn: 0,
    depositCount: 0, withdrawalCount: 0, isLocked: false, createdAt: 0, history: [],
  });

  const algInfo = getAlgorithmInfo();

  useEffect(() => {
    const saved = loadKeyPair();
    if (saved) setKeyPair(saved);
  }, []);

  const securityScore = useMemo(() => calculateSecurityScore({
    hasPQCKey: !!keyPair,
    hasVault: vault.initialized,
    vaultBalance: vault.balance,
    recentWithdrawals: vault.withdrawalCount,
    keyAge: keyPair ? Math.floor((Date.now() - keyPair.createdAt) / 86400000) : 999,
  }), [keyPair, vault]);

  const connectWallet = useCallback(async () => {
    try {
      const solana = (window as any).solana;
      if (solana?.isPhantom) {
        const resp = await solana.connect();
        setWalletAddress(resp.publicKey.toString());
      } else {
        window.open('https://phantom.app/', '_blank');
      }
    } catch (err) {
      console.error('Wallet connection failed:', err);
    }
  }, []);

  const handleGenerateKey = useCallback(async () => {
    setIsGenerating(true);
    await new Promise(resolve => setTimeout(resolve, 150));
    try {
      const kp = generateKeyPair();
      setKeyPair(kp);
    } catch (err) {
      console.error('Key generation failed:', err);
    } finally {
      setIsGenerating(false);
    }
  }, []);

  const refreshVault = useCallback(async () => {
    if (!walletAddress) return;
    try {
      const ownerPk = new PublicKey(walletAddress);
      const data = await fetchVaultData(ownerPk);
      const bal = await getBalance(ownerPk);
      setWalletBalance(bal);
      
      if (data) {
        setVault(v => ({
          ...v,
          initialized: true,
          balance: data.balance,
          totalDeposited: data.totalDeposited,
          totalWithdrawn: data.totalWithdrawn,
          depositCount: data.depositCount,
          withdrawalCount: data.withdrawalCount,
          isLocked: data.isLocked,
          createdAt: data.createdAt || v.createdAt,
        }));
      }
    } catch (e) {
      console.error('Refresh failed:', e);
    }
  }, [walletAddress]);

  useEffect(() => {
    if (walletAddress) {
      refreshVault();
    }
  }, [walletAddress, refreshVault]);

  const initVault = useCallback(async () => {
    if (!keyPair || !walletAddress) return;
    setIsLoading(true);
    try {
      const ownerPk = new PublicKey(walletAddress);
      const ix = buildInitializeVaultIx(ownerPk, keyPair.publicKey);
      const txid = await sendTransaction(ix, ownerPk);
      
      setLastTxId(txid);
      setVault(v => ({
        ...v,
        initialized: true,
        createdAt: Date.now(),
        history: [...v.history, { type: 'init', timestamp: Date.now() }]
      }));
      setActiveTab('vault');
      await refreshVault();
    } catch (err: any) {
      alert('Initialize failed: ' + err.message);
    } finally {
      setIsLoading(false);
    }
  }, [keyPair, walletAddress, refreshVault]);

  const handleDeposit = useCallback(async () => {
    const amt = parseFloat(depositAmount);
    if (!amt || amt <= 0 || !walletAddress) return;
    setIsLoading(true);
    try {
      const ownerPk = new PublicKey(walletAddress);
      const lamports = Math.floor(amt * LAMPORTS_PER_SOL);
      const ix = buildDepositIx(ownerPk, ownerPk, lamports);
      const txid = await sendTransaction(ix, ownerPk);
      
      setLastTxId(txid);
      setVault(v => ({
        ...v,
        balance: v.balance + lamports,
        totalDeposited: v.totalDeposited + lamports,
        depositCount: v.depositCount + 1,
        history: [...v.history, { type: 'deposit', amount: lamports, timestamp: Date.now() }]
      }));
      setDepositAmount('');
      await refreshVault();
    } catch (err: any) {
      alert('Deposit failed: ' + err.message);
    } finally {
      setIsLoading(false);
    }
  }, [depositAmount, walletAddress, refreshVault]);

  const handleWithdraw = useCallback(async () => {
    const amt = parseFloat(withdrawAmount);
    if (!amt || amt <= 0 || !keyPair || !walletAddress || !vault.initialized) return;
    
    const lamports = Math.floor(amt * LAMPORTS_PER_SOL);
    if (lamports > vault.balance) {
      alert('Insufficient balance');
      return;
    }
    
    if (vault.isLocked) {
      alert('Vault is locked');
      return;
    }

    setShowPipeline(true);
    setWithdrawVerified(null);
    setLastWithdrawalAuth(null);
    
    const steps: SignStep[] = [
      { label: 'Build Message', detail: 'Constructing withdrawal authorization...', status: 'pending', icon: '📝' },
      { label: 'ML-DSA-44 Sign', detail: 'Signing with quantum-resistant key...', status: 'pending', icon: '🔮' },
      { label: 'PQC Verify', detail: 'Verifying post-quantum signature locally...', status: 'pending', icon: '🔍' },
      { label: 'Ed25519 Sign', detail: 'Waiting for wallet signature...', status: 'pending', icon: '✍️' },
      { label: 'On-Chain Submit', detail: 'Broadcasting transaction...', status: 'pending', icon: '📡' },
      { label: 'Confirmed', detail: 'Withdrawal complete', status: 'pending', icon: '✅' },
    ];
    setSignSteps(steps);
    setIsLoading(true);

    try {
      const recipient = recipientAddr.trim() || walletAddress;
      const nonce = Date.now();

      updateStep(0, { status: 'active' });
      await new Promise(r => setTimeout(r, 400));
      updateStep(0, { status: 'done', detail: `vault=${walletAddress.slice(0,8)}... amount=${amt} SOL`, time: 0.4 });

      updateStep(1, { status: 'active' });
      const t1 = performance.now();
      const auth = signWithdrawal(walletAddress, recipient, lamports, nonce, keyPair.secretKey);
      const sigTime = ((performance.now() - t1) / 1000).toFixed(2);
      
      setLastWithdrawalAuth(auth);
      updateStep(1, { status: 'done', detail: `Signature: ${auth.pqcSignature.length} bytes`, time: parseFloat(sigTime) });

      updateStep(2, { status: 'active' });
      const t2 = performance.now();
      const result = verifyWithdrawal(auth, keyPair.publicKey);
      const verifyTime = ((performance.now() - t2) / 1000).toFixed(2);
      
      setWithdrawVerified(result);
      if (!result.valid) {
        updateStep(2, { status: 'error', detail: 'Signature verification FAILED', time: parseFloat(verifyTime) });
        setIsLoading(false);
        return;
      }
      updateStep(2, { status: 'done', detail: `Signature verified`, time: parseFloat(verifyTime) });

      updateStep(3, { status: 'active', detail: 'Approve in wallet...' });
      const ownerPk = new PublicKey(walletAddress);
      const recipientPk = new PublicKey(recipient);
      const ix = buildWithdrawIx(ownerPk, recipientPk, lamports, keyPair.publicKey, auth.pqcSignature, nonce);

      const t3 = performance.now();
      const txid = await sendTransaction(ix, ownerPk);
      const txTime = ((performance.now() - t3) / 1000).toFixed(2);
      
      updateStep(3, { status: 'done', detail: 'Ed25519 signature applied', time: 0 });
      updateStep(4, { status: 'done', detail: `TX: ${txid.slice(0, 16)}...`, time: parseFloat(txTime) });
      setLastTxId(txid);

      updateStep(5, { status: 'done', detail: `${amt} SOL withdrawn` });

      setVault(v => ({
        ...v,
        balance: v.balance - lamports,
        totalWithdrawn: v.totalWithdrawn + lamports,
        withdrawalCount: v.withdrawalCount + 1,
        history: [...v.history, { type: 'withdraw', amount: lamports, timestamp: Date.now(), pqcVerified: true }]
      }));
      setWithdrawAmount('');
      setRecipientAddr('');
      await refreshVault();
    } catch (err: any) {
      setSignSteps(prev => prev.map(s => s.status === 'active' ? { ...s, status: 'error', detail: err.message } : s));
    } finally {
      setIsLoading(false);
    }
  }, [withdrawAmount, recipientAddr, keyPair, walletAddress, vault, refreshVault]);

  const toggleLock = useCallback(async () => {
    if (!walletAddress) return;
    setIsLoading(true);
    try {
      const ownerPk = new PublicKey(walletAddress);
      const ix = vault.isLocked ? buildUnlockVaultIx(ownerPk) : buildEmergencyLockIx(ownerPk);
      const txid = await sendTransaction(ix, ownerPk);
      
      setLastTxId(txid);
      setVault(v => ({
        ...v,
        isLocked: !v.isLocked,
        history: [...v.history, { type: v.isLocked ? 'unlock' : 'lock', timestamp: Date.now() }]
      }));
      await refreshVault();
    } catch (err: any) {
      alert('Lock/Unlock failed: ' + err.message);
    } finally {
      setIsLoading(false);
    }
  }, [walletAddress, vault.isLocked, refreshVault]);

  const tabs: [Tab, string][] = [
    ['dashboard', 'Dashboard'],
    ['vault', 'Vault'],
    ['withdraw', 'Withdraw'],
    ['info', 'Architecture'],
  ];

  return (
    <div className="app-container">
      <header className="header">
        <div className="header-brand">
          <div className="header-logo">🛡️</div>
          <div>
            <div className="header-title">QuantumVault</div>
            <div className="header-subtitle">PQC Migration Infrastructure for Solana</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span className="header-badge">FIPS 204</span>
          {walletAddress ? (
            <button className="btn btn-secondary btn-sm" onClick={() => setWalletAddress(null)}>
              {walletAddress.slice(0, 6)}...{walletAddress.slice(-4)}
            </button>
          ) : (
            <button className="btn btn-primary btn-sm" onClick={connectWallet}>Connect Wallet</button>
          )}
        </div>
      </header>

      <section className="hero slide-up">
        <div className="quantum-shield">
          <div className="ring"></div><div className="ring"></div><div className="ring"></div><div className="core"></div>
        </div>
        <h1>Quantum-Safe Asset Vault<br/>for Solana</h1>
        <p>
          Bind quantum-resistant ML-DSA-44 keys to your wallet today. Ensure you can prove asset ownership when the network migrates to post-quantum cryptography.
        </p>
      </section>

      <div className="stat-grid fade-in">
        <div className="stat-card">
          <div className={`stat-value ${securityScore.score >= 70 ? 'green' : securityScore.score >= 40 ? 'cyan' : 'pink'}`}>
            {securityScore.grade}
          </div>
          <div className="stat-label">Security Score ({securityScore.score}/100)</div>
        </div>
        <div className="stat-card">
          <div className="stat-value cyan">{vault.initialized ? lamportsToSol(vault.balance) : '—'}</div>
          <div className="stat-label">Vault Balance (SOL)</div>
        </div>
        <div className="stat-card">
          <div className="stat-value purple">{keyPair ? keyPair.fingerprint.slice(0, 8) : '—'}</div>
          <div className="stat-label">PQC Key ID</div>
        </div>
        <div className="stat-card">
          <div className={`stat-value ${vault.isLocked ? 'pink' : 'green'}`}>
            {vault.initialized ? (vault.isLocked ? 'LOCKED' : 'ACTIVE') : '—'}
          </div>
          <div className="stat-label">Vault Status</div>
        </div>
      </div>

      {(!walletAddress || !keyPair || !vault.initialized) && (
        <div className="card" style={{ marginBottom: '32px', borderColor: 'rgba(108,92,231,0.4)' }}>
          <div className="card-header">
            <div className="card-icon purple">⚡</div>
            <div>
              <div className="card-title">Setup Instructions</div>
              <div className="card-description">Complete setup to protect your assets</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            <div className={`flow-step ${walletAddress ? 'done' : 'active'}`}>
              {walletAddress ? '✓' : '1.'} Connect Wallet
            </div>
            <span className="flow-arrow">→</span>
            <div className={`flow-step ${keyPair ? 'done' : walletAddress ? 'active' : 'pending'}`}>
              {keyPair ? '✓' : '2.'} Generate PQC Key
            </div>
            <span className="flow-arrow">→</span>
            <div className={`flow-step ${vault.initialized ? 'done' : keyPair ? 'active' : 'pending'}`}>
              {vault.initialized ? '✓' : '3.'} Create Vault
            </div>
          </div>
          <div style={{ marginTop: '20px', display: 'flex', gap: '12px' }}>
            {!walletAddress && (
              <button className="btn btn-primary" onClick={connectWallet}>Connect Wallet</button>
            )}
            {walletAddress && !keyPair && (
              <button className="btn btn-primary" onClick={handleGenerateKey} disabled={isGenerating}>
                {isGenerating ? 'Generating...' : 'Generate ML-DSA-44 Key'}
              </button>
            )}
            {walletAddress && keyPair && !vault.initialized && (
              <button className="btn btn-primary" onClick={initVault}>Initialize QuantumVault</button>
            )}
          </div>
          {keyPair && !vault.initialized && (
            <div style={{ marginTop: '12px', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              PQC Key: <span style={{ color: 'var(--accent-cyan)', fontFamily: 'var(--font-mono)' }}>{keyPair.fingerprint}</span>
            </div>
          )}
        </div>
      )}

      <div className="tabs">
        {tabs.map(([id, label]) => (
          <button key={id} className={`tab ${activeTab === id ? 'active' : ''}`} onClick={() => setActiveTab(id)}>
            {label}
          </button>
        ))}
      </div>

      {activeTab === 'dashboard' && (
        <div className="fade-in">
          {securityScore.recommendations.length > 0 && (
            <div className="card" style={{ marginBottom: '24px' }}>
              <div className="card-header">
                <div className="card-icon orange">⚠️</div>
                <div>
                  <div className="card-title">Recommendations</div>
                  <div className="card-description">Improve your quantum readiness</div>
                </div>
              </div>
              {securityScore.recommendations.map((r, i) => (
                <div key={i} style={{ padding: '8px 0', color: 'var(--accent-orange)', fontSize: '0.85rem', borderBottom: '1px solid var(--border-color)' }}>
                  • {r}
                </div>
              ))}
            </div>
          )}

          <div className="card">
            <div className="card-header">
              <div className="card-icon cyan">📜</div>
              <div>
                <div className="card-title">Vault Activity</div>
                <div className="card-description">{vault.history.length} events recorded</div>
              </div>
            </div>
            {vault.history.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>
                No activity yet.
              </div>
            ) : (
              <div>
                {[...vault.history].reverse().map((entry, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--border-color)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: '0.85rem', textTransform: 'capitalize' }}>{entry.type}</div>
                        {entry.amount && <div className="mono-sm" style={{ color: 'var(--text-muted)' }}>{lamportsToSol(entry.amount)} SOL</div>}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {entry.pqcVerified && <span className="status-badge success">PQC ✓</span>}
                      <span className="mono-sm" style={{ color: 'var(--text-muted)' }}>{new Date(entry.timestamp).toLocaleTimeString()}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'vault' && (
        <div className="fade-in">
          {!vault.initialized ? (
            <div className="card" style={{ textAlign: 'center', padding: '60px 24px' }}>
              <div style={{ fontSize: '1.2rem', fontWeight: 700, marginBottom: '8px' }}>Vault Not Initialized</div>
              <div style={{ color: 'var(--text-muted)', marginBottom: '24px' }}>Complete the setup steps above first.</div>
            </div>
          ) : (
            <div className="grid-2">
              <div className="card">
                <div className="card-header">
                  <div className="card-icon green">📥</div>
                  <div>
                    <div className="card-title">Deposit SOL</div>
                  </div>
                </div>
                <div style={{ marginBottom: '16px' }}>
                  <div className="stat-label" style={{ marginBottom: '8px' }}>Amount (SOL)</div>
                  <input className="textarea" style={{ minHeight: 'auto', height: '44px' }} type="number" step="0.01" min="0"
                    placeholder="0.00" value={depositAmount} onChange={e => setDepositAmount(e.target.value)} />
                </div>
                <button className="btn btn-primary" style={{ width: '100%' }} onClick={handleDeposit}
                  disabled={!depositAmount || parseFloat(depositAmount) <= 0}>
                  Deposit to Vault
                </button>
              </div>

              <div className="card">
                <div className="card-header">
                  <div className="card-icon purple">📊</div>
                  <div>
                    <div className="card-title">Vault Details</div>
                  </div>
                </div>
                <table className="info-table">
                  <tbody>
                    <tr><td>Balance</td><td style={{ color: 'var(--accent-green)' }}>{lamportsToSol(vault.balance)} SOL</td></tr>
                    <tr><td>Total Deposited</td><td>{lamportsToSol(vault.totalDeposited)} SOL</td></tr>
                    <tr><td>Total Withdrawn</td><td>{lamportsToSol(vault.totalWithdrawn)} SOL</td></tr>
                    <tr><td>Deposits</td><td>{vault.depositCount}</td></tr>
                    <tr><td>Withdrawals</td><td>{vault.withdrawalCount}</td></tr>
                    <tr><td>Status</td><td>{vault.isLocked ? 'Locked' : 'Active'}</td></tr>
                    <tr><td>PQC Key</td><td style={{ color: 'var(--accent-cyan)' }}>{keyPair?.fingerprint || '—'}</td></tr>
                  </tbody>
                </table>
                <button className={`btn ${vault.isLocked ? 'btn-primary' : 'btn-danger'} btn-sm`}
                  style={{ width: '100%', marginTop: '16px' }} onClick={toggleLock}>
                  {vault.isLocked ? 'Unlock Vault' : 'Emergency Lock'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'withdraw' && (
        <div className="fade-in">
          <div className="card">
            <div className="card-header">
              <div className="card-icon pink">🔐</div>
              <div>
                <div className="card-title">Dual-Signature Withdrawal</div>
                <div className="card-description">
                  Requires Ed25519 (wallet) and ML-DSA-44 (quantum-safe) signatures
                </div>
              </div>
            </div>

            {!vault.initialized || !keyPair ? (
              <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>
                Initialize vault and generate PQC key first.
              </div>
            ) : (
              <>
                <div style={{ background: 'var(--bg-input)', borderRadius: 'var(--radius-sm)', padding: '12px', marginBottom: '20px', fontSize: '0.8rem' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>This withdrawal will be signed by BOTH your Solana wallet (Ed25519) and your quantum-resistant key (ML-DSA-44).</span>
                </div>
                <div style={{ marginBottom: '16px' }}>
                  <div className="stat-label" style={{ marginBottom: '8px' }}>Recipient Address</div>
                  <input className="textarea" style={{ minHeight: 'auto', height: '44px' }}
                    placeholder={walletAddress || ''} value={recipientAddr} onChange={e => setRecipientAddr(e.target.value)} />
                </div>
                <div style={{ marginBottom: '16px' }}>
                  <div className="stat-label" style={{ marginBottom: '8px' }}>Amount (SOL) — Available: {lamportsToSol(vault.balance)}</div>
                  <input className="textarea" style={{ minHeight: 'auto', height: '44px' }} type="number" step="0.01" min="0"
                    placeholder="0.00" value={withdrawAmount} onChange={e => setWithdrawAmount(e.target.value)} />
                </div>
                <button className="btn btn-primary btn-lg" style={{ width: '100%' }} onClick={handleWithdraw}
                  disabled={isLoading || vault.isLocked || !withdrawAmount || parseFloat(withdrawAmount) <= 0}>
                  {vault.isLocked ? 'Vault Locked' : isLoading ? 'Processing...' : 'Sign & Withdraw'}
                </button>

                {showPipeline && signSteps.length > 0 && (
                  <div className="slide-up" style={{ marginTop: '24px' }}>
                    <div style={{ fontSize: '0.85rem', fontWeight: 700, marginBottom: '16px', color: 'var(--accent-cyan)' }}>
                      Execution Pipeline
                    </div>
                    {signSteps.map((step, i) => (
                      <div key={i} style={{
                        display: 'flex', alignItems: 'flex-start', gap: '12px', marginBottom: '4px',
                        padding: '10px 14px', borderRadius: 'var(--radius-sm)',
                        background: step.status === 'active' ? 'rgba(108,92,231,0.15)' : step.status === 'error' ? 'rgba(255,107,129,0.1)' : 'transparent',
                        borderLeft: `3px solid ${step.status === 'done' ? 'var(--accent-green)' : step.status === 'active' ? 'var(--accent-purple)' : step.status === 'error' ? 'var(--accent-red)' : 'var(--border-color)'}`,
                        transition: 'all 0.3s ease',
                      }}>
                        <div style={{ fontSize: '1.3rem', minWidth: '28px', textAlign: 'center' }}>
                          {step.status === 'active' ? '⏳' : step.status === 'done' ? '✅' : step.status === 'error' ? '❌' : step.icon}
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{
                            fontWeight: 600, fontSize: '0.82rem',
                            color: step.status === 'done' ? 'var(--accent-green)' : step.status === 'active' ? 'var(--accent-purple)' : step.status === 'error' ? 'var(--accent-red)' : 'var(--text-muted)',
                          }}>
                            {step.label}
                            {step.time !== undefined && <span style={{ fontWeight: 400, fontSize: '0.72rem', marginLeft: '8px', color: 'var(--text-muted)' }}>{step.time}s</span>}
                          </div>
                          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '2px', fontFamily: step.status === 'done' ? 'var(--font-mono)' : 'inherit' }}>
                            {step.detail}
                          </div>
                        </div>
                        {step.status === 'active' && (
                          <div style={{ width: '16px', height: '16px', border: '2px solid var(--accent-purple)', borderTop: '2px solid transparent', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                        )}
                      </div>
                    ))}

                    {signSteps.every(s => s.status === 'done') && lastWithdrawalAuth && (
                      <div style={{ marginTop: '16px', padding: '16px', background: 'rgba(0,230,118,0.08)', borderRadius: 'var(--radius-md)', border: '1px solid rgba(0,230,118,0.2)' }}>
                        <div style={{ textAlign: 'center', marginBottom: '12px' }}>
                          <div style={{ fontWeight: 700, color: 'var(--accent-green)', fontSize: '0.9rem' }}>Withdrawal Complete</div>
                        </div>
                        <table className="info-table">
                          <tbody>
                            <tr><td>Signature 1</td><td style={{ color: 'var(--accent-green)' }}>Ed25519 (Phantom) ✓</td></tr>
                            <tr><td>Signature 2</td><td style={{ color: 'var(--accent-green)' }}>ML-DSA-44 (FIPS 204) ✓</td></tr>
                            <tr><td>PQC Sig Size</td><td>{lastWithdrawalAuth.pqcSignature.length} bytes</td></tr>
                            <tr><td>Nonce</td><td>{lastWithdrawalAuth.nonce}</td></tr>
                            {lastTxId && <tr><td>TX Hash</td><td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem' }}><a href={`https://explorer.solana.com/tx/${lastTxId}?cluster=devnet`} target="_blank" style={{ color: 'var(--accent-cyan)' }}>{lastTxId.slice(0,20)}...</a></td></tr>}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {activeTab === 'info' && (
        <div className="fade-in grid-2">
          <div className="card">
            <div className="card-header">
              <div className="card-icon purple">📋</div>
              <div>
                <div className="card-title">ML-DSA-44 Specification</div>
                <div className="card-description">CRYSTALS-Dilithium Level 2</div>
              </div>
            </div>
            <table className="info-table">
              <tbody>
                <tr><td>Algorithm</td><td>{algInfo.name}</td></tr>
                <tr><td>NIST Standard</td><td>{algInfo.standard}</td></tr>
                <tr><td>Public Key</td><td>{algInfo.keySizes.publicKey} bytes</td></tr>
                <tr><td>Signature</td><td>{algInfo.keySizes.signature} bytes</td></tr>
                <tr><td>Hardness</td><td style={{ fontSize: '0.72rem', fontFamily: 'var(--font-sans)' }}>{algInfo.hardness}</td></tr>
                <tr><td>Quantum Security</td><td>{algInfo.quantumSecurity}</td></tr>
              </tbody>
            </table>
          </div>

          <div className="card">
            <div className="card-header">
              <div className="card-icon cyan">🎯</div>
              <div>
                <div className="card-title">Dual-Signature Architecture</div>
                <div className="card-description">How withdrawals are protected</div>
              </div>
            </div>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.8 }}>
              <p style={{ marginBottom: '12px' }}>
                QuantumVault mitigates the "Harvest Now, Decrypt Later" threat model. While the base network operates on Ed25519, the application layer enforces a secondary ML-DSA-44 signature for sensitive operations.
              </p>
              <p>
                Both signatures must be valid. If a quantum attacker derives your Ed25519 private key, they still lack the secondary ML-DSA-44 key needed to authorize withdrawals.
              </p>
            </div>
          </div>
        </div>
      )}

      <footer className="footer">
        <p>QuantumVault</p>
      </footer>
    </div>
  );
}

export default App;
