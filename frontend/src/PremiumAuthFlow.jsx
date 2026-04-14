import React, { useState, useEffect, useRef } from 'react';
import { Satellite, Leaf, ArrowLeft, Edit2, Shield, AlertTriangle, CloudSun } from 'lucide-react';
import { RecaptchaVerifier, signInWithPhoneNumber, onAuthStateChanged, signOut } from 'firebase/auth';
import { auth } from './firebase';

/* ─────────────────────────────────────────────────
   Inline animation styles injected into <head>
───────────────────────────────────────────────── */
const AUTH_STYLES = `
  @keyframes authShake {
    0%, 100% { transform: translateX(0); }
    10%, 30%, 50%, 70%, 90% { transform: translateX(-5px); }
    20%, 40%, 60%, 80% { transform: translateX(5px); }
  }
  .auth-shake { animation: authShake 0.4s ease-in-out; }

  @keyframes authDrawCheck {
    to { stroke-dashoffset: 0; }
  }
  .auth-check-path {
    stroke-dasharray: 100;
    stroke-dashoffset: 100;
    animation: authDrawCheck 0.8s 0.2s ease-out forwards;
  }
  .auth-check-circle {
    stroke-dasharray: 283;
    stroke-dashoffset: 283;
    animation: authDrawCheck 0.6s ease-out forwards;
  }

  @keyframes authSlideUp {
    from { opacity: 0; transform: translateY(18px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  .auth-screen { animation: authSlideUp 0.35s ease-out both; }

  @keyframes authFadeIn {
    from { opacity: 0; transform: scale(0.96); }
    to   { opacity: 1; transform: scale(1); }
  }
  .auth-fade-in { animation: authFadeIn 0.5s ease-out both; }

  @keyframes authSpinRing {
    to { transform: rotate(360deg); }
  }
  .auth-spin { animation: authSpinRing 0.8s linear infinite; }

  .dark-input:focus {
    outline: none;
    border-color: #22c55e;
    box-shadow: 0 0 0 1px #22c55e;
  }
  
  /* Remove default arrows from number inputs in some browsers */
  input::-webkit-outer-spin-button,
  input::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }
  input[type=number] {
    -moz-appearance: textfield;
  }
`;

/* ─────────────────────────────────────────────────
   SVG animated checkmark (Minimal Dark)
───────────────────────────────────────────────── */
function AnimatedCheck() {
  return (
    <div className="relative auth-fade-in" style={{ width: 80, height: 80 }}>
      <svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg"
        className="w-full h-full drop-shadow-md">
        <circle cx="50" cy="50" r="45" stroke="#22c55e" strokeWidth="4"
          className="auth-check-circle" fill="rgba(34,197,94,0.05)" />
        <path d="M30 52 L44 66 L70 36" stroke="#22c55e" strokeWidth="5"
          strokeLinecap="round" strokeLinejoin="round" className="auth-check-path" />
      </svg>
      <div className="absolute inset-0 bg-green-500 opacity-5 rounded-full filter blur-xl" />
    </div>
  );
}

/* ─────────────────────────────────────────────────
   Main Auth Flow Component (Minimal Dark)
───────────────────────────────────────────────── */
export default function PremiumAuthFlow({ onAuthSuccess }) {
  const [screen, setScreen]         = useState('phone');   // phone | otp | success
  const [phone, setPhone]           = useState('');
  const [otp, setOtp]               = useState(['','','','','','']);
  const [activeIdx, setActiveIdx]   = useState(0);
  const [countdown, setCountdown]   = useState(60);
  const [isError, setIsError]       = useState(false);
  const [errorMsg, setErrorMsg]     = useState('');
  const [isLoading, setIsLoading]   = useState(false);
  const [confirmRes, setConfirmRes] = useState(null);  
  const [useDemo, setUseDemo]       = useState(false);

  const otpRefs = useRef([]);

  /* Inject CSS once */
  useEffect(() => {
    const el = document.createElement('style');
    el.textContent = AUTH_STYLES;
    document.head.appendChild(el);
    return () => document.head.removeChild(el);
  }, []);

  /* Check if Firebase is configured */
  useEffect(() => {
    try {
      const cfg = auth?.app?.options;
      if (!cfg?.apiKey || cfg.apiKey === 'undefined') setUseDemo(true);
    } catch { setUseDemo(true); }
  }, []);

  /* OTP countdown timer */
  useEffect(() => {
    if (screen !== 'otp' || countdown <= 0) return;
    const t = setInterval(() => setCountdown(v => v - 1), 1000);
    return () => clearInterval(t);
  }, [screen, countdown]);

  /* Focus first OTP input */
  useEffect(() => {
    if (screen === 'otp') setTimeout(() => otpRefs.current[0]?.focus(), 120);
  }, [screen]);

  const rawPhone = phone.replace(/\s/g, '');
  const otpFull  = otp.join('');

  const formatPhone = (val) => {
    const d = val.replace(/\D/g, '').slice(0, 10);
    if (d.length > 6) return `${d.slice(0,3)} ${d.slice(3,6)} ${d.slice(6)}`;
    if (d.length > 3) return `${d.slice(0,3)} ${d.slice(3)}`;
    return d;
  };

  const goTo = (s) => {
    setScreen(null);
    setTimeout(() => setScreen(s), 60);
  };

  const handleSendOtp = async () => {
    if (rawPhone.length !== 10 || isLoading) return;
    setIsLoading(true);
    setIsError(false);

    if (useDemo) {
      setTimeout(() => {
        setIsLoading(false);
        setOtp(['','','','','','']);
        setCountdown(60);
        setIsError(false);
        goTo('otp');
      }, 900);
      return;
    }

    try {
      if (!window.recaptchaVerifier) {
        window.recaptchaVerifier = new RecaptchaVerifier(auth, 'recaptcha-anchor', {
          size: 'invisible',
        });
      }
      const result = await signInWithPhoneNumber(auth, `+91${rawPhone}`, window.recaptchaVerifier);
      setConfirmRes(result);
      setOtp(['','','','','','']);
      setCountdown(60);
      goTo('otp');
    } catch (err) {
      setIsError(true);
      setErrorMsg(err.message || 'Failed to send OTP.');
      window.recaptchaVerifier?.render().then(id => window.grecaptcha?.reset(id)).catch(() => {});
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerify = async () => {
    if (otpFull.length !== 6 || isLoading) return;
    setIsLoading(true);
    setIsError(false);

    if (useDemo) {
      setTimeout(() => {
        setIsLoading(false);
        goTo('success');
        setTimeout(() => onAuthSuccess?.({ uid: 'demo', phone_number: `+91${rawPhone}` }), 1800);
      }, 1500);
      return;
    }

    try {
      const result = await confirmRes.confirm(otpFull);
      const user = result.user;
      const idToken = await user.getIdToken();

      try {
        await fetch('http://localhost:5000/api/auth/verify-token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idToken }),
        });
      } catch {}

      goTo('success');
      setTimeout(() => onAuthSuccess?.({
        uid: user.uid,
        phone_number: user.phoneNumber,
      }), 1800);
    } catch (err) {
      setIsError(true);
      setErrorMsg('Incorrect OTP.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleOtpChange = (e, i) => {
    const v = e.target.value.replace(/\D/g, '').slice(-1);
    const next = [...otp]; next[i] = v; setOtp(next);
    setIsError(false);
    if (v && i < 5) { otpRefs.current[i + 1]?.focus(); setActiveIdx(i + 1); }
  };

  const handleOtpKey = (e, i) => {
    if (e.key === 'Backspace') {
      const next = [...otp];
      if (!next[i] && i > 0) { next[i - 1] = ''; setOtp(next); otpRefs.current[i - 1]?.focus(); setActiveIdx(i - 1); }
      else { next[i] = ''; setOtp(next); }
      setIsError(false);
    } else if (e.key === 'ArrowLeft' && i > 0) { otpRefs.current[i - 1]?.focus(); }
    else if (e.key === 'ArrowRight' && i < 5) { otpRefs.current[i + 1]?.focus(); }
  };

  const handlePaste = (e) => {
    e.preventDefault();
    const d = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    const next = [...otp];
    [...d].forEach((c, i) => { next[i] = c; });
    setOtp(next);
    const ni = Math.min(d.length, 5);
    otpRefs.current[ni]?.focus(); setActiveIdx(ni);
  };

  return (
    <div style={{
      minHeight: '100dvh', background: '#0a0f14',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: '"Inter", system-ui, sans-serif', position: 'relative', overflow: 'hidden',
    }}>
      {/* Abstract dark tech map vibe */}
      <div style={{ position:'absolute', top:'-20%', right:'-10%', width:'50vw', height:'50vw',
        background:'radial-gradient(circle, rgba(34,197,94,0.03) 0%, rgba(10,15,20,0) 70%)', pointerEvents:'none' }} />
      <div style={{ position:'absolute', bottom:'-10%', left:'-10%', width:'40vw', height:'40vw',
        background:'radial-gradient(circle, rgba(59,130,246,0.03) 0%, rgba(10,15,20,0) 70%)', pointerEvents:'none' }} />

      {useDemo && (
        <div style={{
          position:'fixed', top:16, background:'#1e2d3d', border:'1px solid rgba(245,158,11,0.3)',
          color:'#f59e0b', fontSize:11, fontWeight:600, padding:'6px 12px', borderRadius:20,
          zIndex:9999, display:'flex', alignItems:'center', gap:6
        }}>
          <AlertTriangle size={12} /> DEMO MODE
        </div>
      )}

      {/* Main Container */}
      <div style={{
        width:'100%', maxWidth:380, padding:'24px', zIndex:10,
        display:'flex', flexDirection:'column',
      }}>
        
        {/* Logo minimal */}
        <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:40, justifyContent:'center' }}>
          <div style={{ position:'relative', display:'flex', alignItems:'center', justifyContent:'center', width:36, height:36, borderRadius:10, background:'#111820', border:'1px solid rgba(255,255,255,0.05)' }}>
             <Leaf style={{ color:'#22c55e', width:18, height:18 }} />
          </div>
          <span style={{ color:'#e2e8f0', fontWeight:600, fontSize:18, letterSpacing:'0.02em', fontFamily:'"Space Grotesk", system-ui' }}>MindstriX</span>
        </div>

        <div style={{ background:'#111820', borderRadius:16, border:'1px solid rgba(255,255,255,0.05)', padding:24, boxShadow:'0 10px 40px rgba(0,0,0,0.5)' }}>
          
          {/* ══════ SCREEN 1: PHONE ══════ */}
          {screen === 'phone' && (
            <div className="auth-screen">
              <h1 style={{ color:'#e2e8f0', fontSize:20, fontWeight:600, marginBottom:8, fontFamily:'"Space Grotesk"' }}>Access Dashboard</h1>
              <p style={{ color:'#7a90a8', fontSize:13, marginBottom:24, lineHeight:1.5 }}>
                Enter your registered mobile number for satellite monitoring access.
              </p>

              <div style={{ display:'flex', gap:8, marginBottom:20 }}>
                <div style={{
                  display:'flex', alignItems:'center', justifyContent:'center', background:'#1a2432',
                  borderRadius:8, width:52, height:46, border:'1px solid rgba(255,255,255,0.05)',
                  color:'#a0aec0', fontSize:13, fontWeight:500,
                }}>
                  +91
                </div>
                <input
                  className="dark-input"
                  type="tel"
                  inputMode="numeric"
                  placeholder="987 654 3210"
                  value={phone}
                  onChange={e => setPhone(formatPhone(e.target.value))}
                  onKeyDown={e => e.key === 'Enter' && handleSendOtp()}
                  style={{
                    flex:1, height:46, background:'#1a2432', border:'1px solid rgba(255,255,255,0.05)',
                    borderRadius:8, padding:'0 16px', fontSize:15, color:'#e2e8f0',
                    transition:'all 0.2s', fontFamily:'inherit', width:'100%',
                    letterSpacing:'0.05em'
                  }}
                />
              </div>

              {isError && <p style={{ color:'#ef4444', fontSize:12, marginBottom:16 }}>{errorMsg}</p>}

              <button
                onClick={handleSendOtp}
                disabled={rawPhone.length !== 10 || isLoading}
                style={{
                  width:'100%', height:44, background: rawPhone.length === 10 && !isLoading ? '#22c55e' : '#1e2d3d',
                  color: rawPhone.length === 10 && !isLoading ? '#0a0f14' : '#4a5568',
                  border:'none', borderRadius:8, fontSize:14, fontWeight:600, cursor: rawPhone.length === 10 ? 'pointer' : 'not-allowed',
                  display:'flex', alignItems:'center', justifyContent:'center', transition:'all 0.2s',
                }}
              >
                {isLoading
                  ? <div className="auth-spin" style={{ width:18, height:18, border:'2px solid rgba(10,15,20,0.2)', borderTopColor:'#0a0f14', borderRadius:'50%' }} />
                  : 'Continue'}
              </button>
            </div>
          )}

          {/* ══════ SCREEN 2: OTP ══════ */}
          {screen === 'otp' && (
            <div className="auth-screen">
              <div style={{ display:'flex', alignItems:'center', marginBottom:20, gap:12 }}>
                <button onClick={() => goTo('phone')} style={{
                  width:32, height:32, background:'#1a2432', border:'1px solid rgba(255,255,255,0.05)',
                  borderRadius:8, display:'flex', alignItems:'center', justifyContent:'center',
                  cursor:'pointer', color:'#a0aec0', transition:'all 0.2s',
                }}>
                  <ArrowLeft size={16} />
                </button>
                <h2 style={{ color:'#e2e8f0', fontSize:18, fontWeight:600, margin:0, fontFamily:'"Space Grotesk"' }}>Verify OTP</h2>
              </div>
              
              <p style={{ color:'#7a90a8', fontSize:13, marginBottom:24, display:'flex', alignItems:'center', gap:6 }}>
                Sent to <span style={{ color:'#e2e8f0' }}>+91 {phone}</span>
              </p>

              <div className={isError ? 'auth-shake' : ''} style={{ display:'flex', gap:8, justifyContent:'space-between', marginBottom:20 }}>
                {otp.map((d, i) => (
                  <input
                    key={i}
                    className="dark-input auth-otp-input"
                    ref={el => otpRefs.current[i] = el}
                    type="tel"
                    inputMode="numeric"
                    maxLength={1}
                    value={d}
                    onChange={e => handleOtpChange(e, i)}
                    onKeyDown={e => handleOtpKey(e, i)}
                    onPaste={handlePaste}
                    onFocus={() => setActiveIdx(i)}
                    style={{
                      width:42, height:50, textAlign:'center', fontSize:18, fontWeight:500,
                      borderRadius:8, border:`1px solid ${isError ? '#ef4444' : d || i === activeIdx ? '#22c55e' : 'rgba(255,255,255,0.05)'}`,
                      background:'#1a2432', color: isError ? '#ef4444' : '#e2e8f0',
                      transition:'all 0.15s', cursor:'text', padding:0
                    }}
                  />
                ))}
              </div>

              {isError && <p style={{ color:'#ef4444', fontSize:12, marginBottom:16 }}>{errorMsg}</p>}

              <button
                onClick={handleVerify}
                disabled={otpFull.length !== 6 || isLoading}
                style={{
                  width:'100%', height:44, background: otpFull.length === 6 && !isLoading ? '#22c55e' : '#1e2d3d',
                  color: otpFull.length === 6 && !isLoading ? '#0a0f14' : '#4a5568',
                  border:'none', borderRadius:8, fontSize:14, fontWeight:600, cursor: otpFull.length === 6 ? 'pointer' : 'not-allowed',
                  display:'flex', alignItems:'center', justifyContent:'center', transition:'all 0.2s', marginBottom:16
                }}
              >
                {isLoading
                  ? <div className="auth-spin" style={{ width:18, height:18, border:'2px solid rgba(10,15,20,0.2)', borderTopColor:'#0a0f14', borderRadius:'50%' }} />
                  : 'Verify'}
              </button>

              <div style={{ textAlign:'center', fontSize:12, color:'#7a90a8' }}>
                {countdown > 0
                  ? <span>Resend in {String(countdown).padStart(2,'0')}s</span>
                  : <button onClick={() => { setCountdown(60); setOtp(['','','','','','']); setIsError(false); handleSendOtp(); }} style={{ background:'none', border:'none', color:'#22c55e', cursor:'pointer' }}>Resend Now</button>
                }
              </div>
            </div>
          )}

          {/* ══════ SCREEN 3: SUCCESS ══════ */}
          {screen === 'success' && (
            <div className="auth-screen" style={{ display:'flex', flexDirection:'column', alignItems:'center', padding:'20px 0 10px' }}>
              <AnimatedCheck />
              <h2 style={{ color:'#e2e8f0', fontSize:20, fontWeight:600, margin:'20px 0 8px', fontFamily:'"Space Grotesk"' }}>Authenticated</h2>
              <p style={{ color:'#7a90a8', fontSize:13, margin:0, marginBottom:24 }}>Connecting to environment...</p>
            </div>
          )}
        </div>

        <div style={{ textAlign:'center', marginTop:24, color:'#4a5568', fontSize:10, letterSpacing:'0.05em', display:'flex', alignItems:'center', justifyContent:'center', gap:4 }}>
          <Shield size={10} /> MINDSTRIX SECURE AUTH
        </div>
      </div>
      <div id="recaptcha-anchor" />
    </div>
  );
}
