import React, { useState, useEffect } from 'react';
import { RecaptchaVerifier, signInWithPhoneNumber } from 'firebase/auth';
import { auth } from './firebase';

const AuthModal = ({ isOpen, onClose, onLoginSuccess }) => {
  const [phoneNumber, setPhoneNumber] = useState('');
  const [otp, setOtp] = useState('');
  const [step, setStep] = useState(1); // 1: Phone, 2: OTP
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [confirmationResult, setConfirmationResult] = useState(null);

  useEffect(() => {
    // Initialize reCAPTCHA when the modal opens
    if (isOpen && !window.recaptchaVerifier) {
      window.recaptchaVerifier = new RecaptchaVerifier(auth, 'recaptcha-container', {
        size: 'invisible',
        callback: (response) => {
          // reCAPTCHA solved
        },
        'expired-callback': () => {
          // Response expired, reset
          setError("reCAPTCHA expired. Please try again.");
          window.recaptchaVerifier.clear();
          window.recaptchaVerifier = null;
        }
      });
    }
    
    // Cleanup on unmount or close
    return () => {
      if (!isOpen && window.recaptchaVerifier) {
        window.recaptchaVerifier.clear();
        window.recaptchaVerifier = null;
      }
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSendOtp = async (e) => {
    e.preventDefault();
    setError('');
    
    let formattedPhone = phoneNumber.trim();
    if (!formattedPhone.startsWith('+')) {
      // Default to +91 (India) if no country code provided
      formattedPhone = '+91' + formattedPhone;
    }

    try {
      setLoading(true);
      const appVerifier = window.recaptchaVerifier;
      const result = await signInWithPhoneNumber(auth, formattedPhone, appVerifier);
      setConfirmationResult(result);
      setStep(2);
    } catch (err) {
      console.error(err);
      setError(err.message || 'Failed to send OTP. Please try again.');
      // Reset recaptcha on error so user can try again
      if (window.recaptchaVerifier) {
        window.recaptchaVerifier.render().then(widgetId => {
          window.grecaptcha.reset(widgetId);
        });
      }
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (e) => {
    e.preventDefault();
    setError('');
    
    if (!confirmationResult) {
      setError('Please request an OTP first.');
      return;
    }

    try {
      setLoading(true);
      const result = await confirmationResult.confirm(otp);
      const user = result.user;
      
      // Get the Firebase JWT
      const idToken = await user.getIdToken();
      
      // Send it to our Python Backend
      const response = await fetch('http://localhost:5000/api/auth/verify-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken })
      });
      
      const data = await response.json();
      
      if (!response.ok) throw new Error(data.error || 'Server validation failed');
      
      // Success! Pass data up
      onLoginSuccess(data.user);
      onClose();
    } catch (err) {
      console.error(err);
      setError(err.message || 'Invalid OTP. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-60">
      <div className="bg-[#1e1e1e] p-8 rounded-lg shadow-xl w-full max-w-md border border-[#333]">
        <h2 className="text-2xl font-semibold text-white mb-6">
          {step === 1 ? 'Login with Phone' : 'Verify OTP'}
        </h2>
        
        {error && (
          <div className="mb-4 p-3 bg-red-900/50 border border-red-500 rounded text-red-200 text-sm">
            {error}
          </div>
        )}

        {step === 1 ? (
          <form onSubmit={handleSendOtp}>
            <div className="mb-4">
              <label className="block text-gray-400 mb-2 text-sm">Mobile Number</label>
              <input
                type="tel"
                placeholder="+91 9876543210"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                className="w-full bg-[#2a2a2a] text-white border border-[#444] rounded p-3 focus:outline-none focus:border-[#4ade80]"
                required
                disabled={loading}
              />
            </div>
            {/* Invisible Recaptcha Container */}
            <div id="recaptcha-container"></div>
            
            <button
              type="submit"
              disabled={loading}
              className={`w-full p-3 rounded font-medium ${
                loading ? 'bg-gray-600 cursor-not-allowed' : 'bg-[#10b981] hover:bg-[#059669] text-white'
              }`}
            >
              {loading ? 'Sending...' : 'Send OTP'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleVerifyOtp}>
            <div className="mb-6">
              <label className="block text-gray-400 mb-2 text-sm">Enter 6-digit OTP</label>
              <input
                type="text"
                placeholder="123456"
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
                className="w-full bg-[#2a2a2a] text-white border border-[#444] rounded p-3 text-center tracking-widest text-lg focus:outline-none focus:border-[#4ade80]"
                maxLength={6}
                required
                disabled={loading}
              />
            </div>
            
            <button
              type="submit"
              disabled={loading}
              className={`w-full p-3 rounded font-medium mb-3 ${
                loading ? 'bg-gray-600 cursor-not-allowed' : 'bg-[#10b981] hover:bg-[#059669] text-white'
              }`}
            >
              {loading ? 'Verifying...' : 'Verify & Login'}
            </button>
            <button
              type="button"
              onClick={() => setStep(1)}
              disabled={loading}
              className="w-full p-2 text-gray-400 hover:text-white text-sm"
            >
              Change phone number
            </button>
          </form>
        )}
        
        <button 
          onClick={onClose} 
          className="absolute top-4 right-4 text-gray-500 hover:text-white"
        >
          ✕
        </button>
      </div>
    </div>
  );
};

export default AuthModal;
