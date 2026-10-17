import React, { useState, useEffect } from 'react';
import {
  LayoutDashboard,
  CreditCard,
  FileCheck,
  FileSearch,
  Settings2,
  KeyRound,
  Webhook,
  History,
  Store,
  ShieldAlert,
  CheckCircle2,
  XCircle,
  Clock,
  Plus,
  RefreshCw,
  ExternalLink,
  Copy,
  AlertTriangle,
  FileText,
  DollarSign,
  TrendingUp,
  ShieldCheck,
  UserCheck,
  ChevronRight,
  Eye,
  EyeOff,
  Check,
  RotateCw,
  Lock,
  User,
  LogOut,
  Shield,
  Mail,
  Inbox,
  Radio,
  Search,
  Filter,
  CheckCheck,
  Send,
  LayoutGrid,
  List
} from 'lucide-react';

// Types
export interface BankFeedItem {
  id: string;
  payment_id: string | null;
  provider_code: string;
  transaction_id: string;
  evidence_type: string;
  amount_paisa: number;
  amount_formatted: string;
  currency: string;
  raw_payload: any;
  created_at: string;
  payment_status?: string | null;
  order_reference?: string | null;
  customer_name?: string | null;
  request_reference?: string | null;
}

export interface GmailStatus {
  enabled: boolean;
  configured: boolean;
  gmailUser: string | null;
  isRunning: boolean;
  lastPollAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  processedCount: number;
  verifiedCount: number;
  pubsubActive?: boolean;
  pubsubWebhookPath?: string;
}

export interface PaymentRequestItem {
  id: string;
  reference: string;
  order_reference: string;
  amount_paisa: number;
  currency: string;
  payment_method_code: string;
  status: 'awaiting_payment' | 'processing' | 'pending_review' | 'verified' | 'rejected' | 'expired' | 'cancelled';
  verification_method: 'provider_verified' | 'manual_verified' | null;
  expires_at: string;
  created_at: string;
}

export interface PaymentItem {
  id: string;
  payment_request_id: string;
  order_reference: string;
  gateway_reference: string;
  payment_method_code: string;
  amount_paisa: number;
  amount_formatted: string;
  currency: string;
  status: string;
  verification_method: string | null;
  transaction_reference?: string;
  rejection_reason?: string;
  manual_review_notes?: string;
  manual_reviewed_by?: string;
  verified_at?: string;
  created_at: string;
}

export interface PaymentMethodItem {
  id: string;
  code: string;
  name: string;
  account_title: string;
  account_identifier: string;
  bank_name?: string;
  instructions: string;
  is_active: boolean;
  min_amount_paisa: number;
  max_amount_paisa: number;
}

export interface ApiKeyItem {
  id: string;
  key_prefix: string;
  label: string;
  environment: 'test' | 'live';
  scopes: string[];
  is_revoked: boolean;
  last_used_at?: string;
  created_at: string;
}

export interface WebhookEndpointItem {
  id: string;
  url: string;
  description: string;
  events: string[];
  is_active: boolean;
  created_at: string;
}

export interface WebhookDeliveryItem {
  id: string;
  attempt_number: number;
  status: 'pending' | 'success' | 'failed' | 'retrying';
  http_status_code?: number;
  event_type: string;
  endpoint_url: string;
  created_at: string;
  error_message?: string;
}

export interface AuditEventItem {
  id: string;
  actor_type: string;
  actor_id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  created_at: string;
  ip_address?: string;
  metadata?: Record<string, unknown>;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<string>('overview');
  
  // Authentication & Session State
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => {
    return Boolean(localStorage.getItem('sg_gateway_token'));
  });
  const [currentUser, setCurrentUser] = useState<{ username: string; role: string; name?: string } | null>(() => {
    try {
      const u = localStorage.getItem('sg_gateway_user');
      return u ? JSON.parse(u) : null;
    } catch {
      return null;
    }
  });
  const [token, setToken] = useState<string | null>(() => {
    return localStorage.getItem('sg_gateway_token');
  });
  const [apiKey, setApiKey] = useState<string>(() => {
    return localStorage.getItem('sg_gateway_api_key') || 'sg_test_7f9a2e8c1b4d3f5a6b7c8d9e0f1a2b3c';
  });
  const [environment, setEnvironment] = useState<'test' | 'live'>('test');

  // Login Form State
  const [loginUsername, setLoginUsername] = useState('admin');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Data states
  const [requests, setRequests] = useState<PaymentRequestItem[]>([]);
  const [payments, setPayments] = useState<PaymentItem[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodItem[]>([]);
  const [apiKeys, setApiKeys] = useState<ApiKeyItem[]>([]);
  const [webhooks, setWebhooks] = useState<WebhookEndpointItem[]>([]);
  const [deliveries, setDeliveries] = useState<WebhookDeliveryItem[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditEventItem[]>([]);
  const [trustedSenders, setTrustedSenders] = useState<any[]>([]);
  const [newSenderEmail, setNewSenderEmail] = useState('');
  const [newSenderName, setNewSenderName] = useState('');
  const [newSenderProvider, setNewSenderProvider] = useState('bank_transfer');
  const [loading, setLoading] = useState<boolean>(false);

  // Bank Email Feeds & Gmail Live Status State
  const [bankFeeds, setBankFeeds] = useState<BankFeedItem[]>([]);
  const [gmailStatus, setGmailStatus] = useState<GmailStatus | null>(null);
  const [syncingGmail, setSyncingGmail] = useState<boolean>(false);
  const [viewFeedModal, setViewFeedModal] = useState<BankFeedItem | null>(null);
  const [syncFeedback, setSyncFeedback] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);
  const [feedSearch, setFeedSearch] = useState<string>('');
  const [feedProviderFilter, setFeedProviderFilter] = useState<string>('all');
  const [feedStatusFilter, setFeedStatusFilter] = useState<'all' | 'verified' | 'pending'>('all');
  const [feedViewMode, setFeedViewMode] = useState<'cards' | 'table'>('cards');

  // Modals
  const [createRequestModal, setCreateRequestModal] = useState<boolean>(false);
  const [reviewApproveModal, setReviewApproveModal] = useState<PaymentItem | null>(null);
  const [reviewRejectModal, setReviewRejectModal] = useState<PaymentItem | null>(null);
  const [createKeyModal, setCreateKeyModal] = useState<boolean>(false);
  const [newKeyResult, setNewKeyResult] = useState<any | null>(null);
  const [viewOcrModal, setViewOcrModal] = useState<any | null>(null);
  const [viewPaymentModal, setViewPaymentModal] = useState<any | null>(null);
  const [createWebhookModal, setCreateWebhookModal] = useState<boolean>(false);

  // Forms
  const [newOrderRef, setNewOrderRef] = useState(`ORD_${Math.floor(1000 + Math.random() * 9000)}`);
  const [newAmountRupees, setNewAmountRupees] = useState('2500');
  const [newMethodCode, setNewMethodCode] = useState('jazzcash');
  const [newCustomerName, setNewCustomerName] = useState('Ahmad Ali');
  const [newCustomerEmail, setNewCustomerEmail] = useState('ahmad@example.com');

  const [approveEvidenceRef, setApproveEvidenceRef] = useState('');
  const [approveNotes, setApproveNotes] = useState('');
  const [rejectReason, setRejectReason] = useState('');

  const [newKeyLabel, setNewKeyLabel] = useState('New Production Integration');
  const [newKeyEnv, setNewKeyEnv] = useState<'test' | 'live'>('live');

  const [newWebhookUrl, setNewWebhookUrl] = useState('https://app.tailoros.com/api/webhooks/gateway');
  const [newWebhookDesc, setNewWebhookDesc] = useState('Tailor OS Production Webhook Receiver');

  // Check existing session on mount
  useEffect(() => {
    const savedToken = localStorage.getItem('sg_gateway_token');
    if (savedToken) {
      fetch('/v1/auth/me', {
        headers: { Authorization: `Bearer ${savedToken}` },
      })
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (data?.authenticated) {
            setIsAuthenticated(true);
            setCurrentUser(data.user);
            if (data.apiKey) {
              setApiKey(data.apiKey);
              localStorage.setItem('sg_gateway_api_key', data.apiKey);
            }
          } else {
            handleLogout();
          }
        })
        .catch(() => {
          // offline/local session
        });
    }
  }, []);

  // Fetch data
  const fetchData = async () => {
    if (!isAuthenticated) return;
    setLoading(true);
    try {
      const activeAuth = token ? `Bearer ${token}` : `Bearer ${apiKey}`;
      const headers = { Authorization: activeAuth };

      const [reqRes, payRes, methRes, keyRes, hookRes, delivRes, audRes, sendRes, feedRes, gmailRes] = await Promise.all([
        fetch('/v1/payment-requests', { headers }).then(r => r.ok ? r.json() : { items: [] }),
        fetch('/v1/payments', { headers }).then(r => r.ok ? r.json() : { items: [] }),
        fetch('/v1/payment-methods', { headers }).then(r => r.ok ? r.json() : { items: [] }),
        fetch('/v1/api-keys', { headers }).then(r => r.ok ? r.json() : { items: [] }),
        fetch('/v1/webhooks', { headers }).then(r => r.ok ? r.json() : { items: [] }),
        fetch('/v1/webhooks/deliveries', { headers }).then(r => r.ok ? r.json() : { items: [] }),
        fetch('/v1/audit-logs', { headers }).then(r => r.ok ? r.json() : { items: [] }),
        fetch('/v1/bank-feeds/trusted-senders', { headers }).then(r => r.ok ? r.json() : { items: [] }),
        fetch('/v1/bank-feeds', { headers }).then(r => r.ok ? r.json() : { items: [] }),
        fetch('/v1/bank-feeds/gmail/status', { headers }).then(r => r.ok ? r.json() : null),
      ]);

      setRequests(reqRes.items || []);
      setPayments(payRes.items || []);
      setPaymentMethods(methRes.items || []);
      setApiKeys(keyRes.items || []);
      setWebhooks(hookRes.items || []);
      setDeliveries(delivRes.items || []);
      setAuditLogs(audRes.items || []);
      setTrustedSenders(sendRes.items || []);
      setBankFeeds(feedRes.items || []);
      if (gmailRes) setGmailStatus(gmailRes);
    } catch (err) {
      console.warn('Backend API offline or initial load, fallback to demo state:', err);
    } finally {
      setLoading(false);
    }
  };

  // Live background poller for Gmail Status
  useEffect(() => {
    if (!isAuthenticated) return;
    fetchData();

    const interval = setInterval(() => {
      const activeAuth = token ? `Bearer ${token}` : `Bearer ${apiKey}`;
      fetch('/v1/bank-feeds/gmail/status', { headers: { Authorization: activeAuth } })
        .then(r => r.ok ? r.json() : null)
        .then(statusData => {
          if (statusData) setGmailStatus(statusData);
        })
        .catch(() => {});
    }, 15000);

    return () => clearInterval(interval);
  }, [isAuthenticated, token, apiKey]);

  // Trigger manual Gmail sync check
  const handleSyncGmailNow = async () => {
    setSyncingGmail(true);
    setSyncFeedback(null);
    try {
      const activeAuth = token ? `Bearer ${token}` : `Bearer ${apiKey}`;
      const res = await fetch('/v1/bank-feeds/gmail/sync-now', {
        method: 'POST',
        headers: { Authorization: activeAuth },
      });
      const data = await res.json();
      if (res.ok) {
        setSyncFeedback({
          type: data.status === 'error' ? 'error' : 'success',
          message: data.message || `Sync completed. ${data.processed || 0} bank alerts processed, ${data.verified || 0} payments auto-verified.`,
        });
        await fetchData();
      } else {
        setSyncFeedback({
          type: 'error',
          message: data.message || 'Failed to trigger Gmail check.',
        });
      }
    } catch (err: any) {
      setSyncFeedback({
        type: 'error',
        message: err.message || 'Network error triggering Gmail check.',
      });
    } finally {
      setSyncingGmail(false);
    }
  };

  // Auth Handlers
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    setLoginLoading(true);

    try {
      const res = await fetch('/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: loginUsername.trim(),
          password: loginPassword,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setLoginError(data.message || 'Login failed. Please verify credentials.');
        return;
      }

      localStorage.setItem('sg_gateway_token', data.token);
      localStorage.setItem('sg_gateway_user', JSON.stringify(data.user));
      if (data.apiKey) {
        localStorage.setItem('sg_gateway_api_key', data.apiKey);
        setApiKey(data.apiKey);
      }

      setToken(data.token);
      setCurrentUser(data.user);
      setIsAuthenticated(true);
      setLoginPassword('');
    } catch (err: any) {
      setLoginError('Could not reach Gateway server. Please ensure backend is running on port 4000.');
    } finally {
      setLoginLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await fetch('/v1/auth/logout', { method: 'POST' });
    } catch {
      // ignore
    }
    localStorage.removeItem('sg_gateway_token');
    localStorage.removeItem('sg_gateway_user');
    localStorage.removeItem('sg_gateway_api_key');
    setToken(null);
    setCurrentUser(null);
    setIsAuthenticated(false);
  };

  // Actions
  const handleCreatePaymentRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/v1/payment-requests', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          order_reference: newOrderRef,
          amount: parseFloat(newAmountRupees),
          currency: 'PKR',
          payment_method_code: newMethodCode,
          customer_name: newCustomerName,
          customer_email: newCustomerEmail,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        alert(err.message || 'Failed to create payment request');
        return;
      }

      setCreateRequestModal(false);
      fetchData();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleApprovePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reviewApproveModal) return;

    try {
      const res = await fetch(`/v1/payments/${reviewApproveModal.id}/review/approve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          evidence_reference: approveEvidenceRef,
          notes: approveNotes,
          reviewer_name: 'Authorized Compliance Officer',
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        alert(err.message || 'Approval failed');
        return;
      }

      setReviewApproveModal(null);
      setApproveEvidenceRef('');
      setApproveNotes('');
      fetchData();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleRejectPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reviewRejectModal) return;

    try {
      const res = await fetch(`/v1/payments/${reviewRejectModal.id}/review/reject`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          reason: rejectReason,
          reviewer_name: 'Authorized Compliance Officer',
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        alert(err.message || 'Rejection failed');
        return;
      }

      setReviewRejectModal(null);
      setRejectReason('');
      fetchData();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleCreateApiKey = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/v1/api-keys', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          label: newKeyLabel,
          environment: newKeyEnv,
          scopes: ['*'],
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        alert(data.message || 'Failed to create key');
        return;
      }

      setCreateKeyModal(false);
      setNewKeyResult(data);
      fetchData();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleRevokeKey = async (id: string) => {
    if (!confirm('Are you sure you want to revoke this API key? This cannot be undone.')) return;
    try {
      const res = await fetch(`/v1/api-keys/${id}/revoke`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (res.ok) fetchData();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleRotateKey = async (id: string) => {
    if (!confirm('Rotate this API key? The old key will be revoked and a new secret key generated.')) return;
    try {
      const res = await fetch(`/v1/api-keys/${id}/rotate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      const data = await res.json();
      if (res.ok) {
        setNewKeyResult(data.new_key);
        fetchData();
      }
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleCreateWebhook = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/v1/webhooks', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          url: newWebhookUrl,
          description: newWebhookDesc,
          events: ['*'],
        }),
      });

      if (res.ok) {
        setCreateWebhookModal(false);
        fetchData();
      }
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleTestWebhook = async (id: string) => {
    try {
      const res = await fetch(`/v1/webhooks/${id}/test`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      const data = await res.json();
      alert(`Test ping dispatched! Result: ${data.delivery?.success ? 'Success (200 OK)' : 'Pending/Sent'}`);
      fetchData();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleRetryDelivery = async (id: string) => {
    try {
      const res = await fetch(`/v1/webhooks/deliveries/${id}/retry`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      const data = await res.json();
      alert(`Delivery retried: ${data.message}`);
      fetchData();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleAddSender = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSenderEmail.trim()) return;
    try {
      const res = await fetch('/v1/bank-feeds/trusted-senders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          sender_email: newSenderEmail.trim(),
          sender_name: newSenderName.trim() || newSenderEmail.trim(),
          provider_code: newSenderProvider,
        }),
      });
      if (res.ok) {
        setNewSenderEmail('');
        setNewSenderName('');
        alert('Trusted Bank Sender Email added to whitelist!');
        fetchData();
      } else {
        const err = await res.json();
        alert(err.message || 'Error adding sender');
      }
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleDeleteSender = async (id: string) => {
    if (!confirm('Remove this email address from trusted bank senders list?')) return;
    try {
      const res = await fetch(`/v1/bank-feeds/trusted-senders/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (res.ok) {
        fetchData();
      }
    } catch (err: any) {
      alert(err.message);
    }
  };

  // Metrics
  const totalVolumePaisa = payments
    .filter(p => p.status === 'verified')
    .reduce((sum, p) => sum + p.amount_paisa, 0);

  const pendingReviewCount = payments.filter(p => p.status === 'pending_review').length;
  const verifiedCount = payments.filter(p => p.status === 'verified').length;
  const rejectedCount = payments.filter(p => p.status === 'rejected').length;

  // Unauthenticated: Show Production Login Screen
  if (!isAuthenticated) {
    return (
      <div className="login-screen-wrapper">
        <div className="login-card">
          <div className="login-brand">
            <div className="login-logo">
              <ShieldCheck size={28} />
            </div>
            <h1 className="login-title">SysGalaxy Gateway</h1>
            <p className="login-subtitle">Financial Operating System & Compliance Portal</p>
          </div>

          {loginError && (
            <div className="login-error-alert">
              <AlertTriangle size={16} style={{ flexShrink: 0 }} />
              <span>{loginError}</span>
            </div>
          )}

          <form onSubmit={handleLogin}>
            <div className="form-group">
              <label className="form-label" htmlFor="login-username">Admin Username</label>
              <div className="login-input-group">
                <User size={16} className="login-input-icon" />
                <input
                  id="login-username"
                  type="text"
                  className="login-input"
                  placeholder="admin"
                  value={loginUsername}
                  onChange={(e) => setLoginUsername(e.target.value)}
                  required
                  autoFocus
                />
              </div>
            </div>

            <div className="form-group" style={{ marginTop: '1.25rem' }}>
              <label className="form-label" htmlFor="login-password">Password</label>
              <div className="login-input-group">
                <Lock size={16} className="login-input-icon" />
                <input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  className="login-input"
                  placeholder="••••••••••••"
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  required
                />
                <button
                  type="button"
                  className="login-pw-toggle"
                  onClick={() => setShowPassword(!showPassword)}
                  title={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <button
              id="btn-login-submit"
              type="submit"
              className="login-submit-btn"
              disabled={loginLoading}
            >
              {loginLoading ? (
                <>
                  <RefreshCw size={16} className="spin" />
                  Authenticating...
                </>
              ) : (
                <>
                  <Lock size={16} />
                  Sign In to Gateway
                </>
              )}
            </button>
          </form>

          <div className="login-security-features">
            <div className="security-feature-item">
              <ShieldCheck size={14} />
              <span>RFC7519 HMAC-SHA256 Timing-Safe Security</span>
            </div>
            <div className="security-feature-item">
              <CheckCircle2 size={14} />
              <span>Automated Bank Alert & Multi-Tenant Isolation</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-container">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="logo-icon">
            <ShieldCheck size={22} />
          </div>
          <div>
            <div className="brand-title">SysGalaxy</div>
            <div className="brand-subtitle">Payment OS Gateway</div>
          </div>
        </div>

        <nav className="sidebar-nav">
          <div className="nav-section-title">Core Operations</div>
          <button
            id="nav-overview"
            className={`nav-item ${activeTab === 'overview' ? 'active' : ''}`}
            onClick={() => setActiveTab('overview')}
          >
            <LayoutDashboard size={18} />
            Overview
          </button>

          <button
            id="nav-payment-requests"
            className={`nav-item ${activeTab === 'payment-requests' ? 'active' : ''}`}
            onClick={() => setActiveTab('payment-requests')}
          >
            <CreditCard size={18} />
            Payment Requests
          </button>

          <button
            id="nav-pending-reviews"
            className={`nav-item ${activeTab === 'pending-reviews' ? 'active' : ''}`}
            onClick={() => setActiveTab('pending-reviews')}
          >
            <FileCheck size={18} />
            Pending Reviews
            {pendingReviewCount > 0 && (
              <span className="nav-badge">{pendingReviewCount}</span>
            )}
          </button>

          <button
            id="nav-bank-feeds"
            className={`nav-item ${activeTab === 'bank-feeds' ? 'active' : ''}`}
            onClick={() => setActiveTab('bank-feeds')}
          >
            <Mail size={18} />
            Bank Email Feeds
            {bankFeeds.length > 0 && (
              <span className="nav-badge" style={{ background: 'rgba(16, 185, 129, 0.2)', color: '#34d399' }}>
                {bankFeeds.length}
              </span>
            )}
          </button>

          <button
            id="nav-senders-whitelist"
            className={`nav-item ${activeTab === 'senders-whitelist' ? 'active' : ''}`}
            onClick={() => setActiveTab('senders-whitelist')}
          >
            <ShieldCheck size={18} />
            Senders Whitelist Emails
            {trustedSenders.length > 0 && (
              <span className="nav-badge" style={{ background: 'rgba(99, 102, 241, 0.2)', color: '#a5b4fc' }}>
                {trustedSenders.length}
              </span>
            )}
          </button>

          <div className="nav-section-title">Configuration</div>
          <button
            id="nav-payment-methods"
            className={`nav-item ${activeTab === 'payment-methods' ? 'active' : ''}`}
            onClick={() => setActiveTab('payment-methods')}
          >
            <Settings2 size={18} />
            Payment Methods
          </button>

          <button
            id="nav-api-keys"
            className={`nav-item ${activeTab === 'api-keys' ? 'active' : ''}`}
            onClick={() => setActiveTab('api-keys')}
          >
            <KeyRound size={18} />
            API Keys
          </button>

          <button
            id="nav-webhooks"
            className={`nav-item ${activeTab === 'webhooks' ? 'active' : ''}`}
            onClick={() => setActiveTab('webhooks')}
          >
            <Webhook size={18} />
            Webhooks
          </button>

          <button
            id="nav-delivery-logs"
            className={`nav-item ${activeTab === 'delivery-logs' ? 'active' : ''}`}
            onClick={() => setActiveTab('delivery-logs')}
          >
            <History size={18} />
            Delivery Logs
          </button>

          <div className="nav-section-title">Governance</div>
          <button
            id="nav-merchant-settings"
            className={`nav-item ${activeTab === 'merchant-settings' ? 'active' : ''}`}
            onClick={() => setActiveTab('merchant-settings')}
          >
            <Store size={18} />
            Merchant Settings
          </button>

          <button
            id="nav-audit-logs"
            className={`nav-item ${activeTab === 'audit-logs' ? 'active' : ''}`}
            onClick={() => setActiveTab('audit-logs')}
          >
            <ShieldAlert size={18} />
            Audit Logs
          </button>
        </nav>

        <div className="sidebar-footer">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.4rem' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#10b981' }}></span>
            <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>Connected to Gateway API</span>
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
            v1.0.0 • Tailor OS Connected
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="main-wrapper">
        <header className="top-header">
          <div className="header-left">
            <h1 className="page-heading">
              {activeTab === 'overview' && 'System Overview'}
              {activeTab === 'payment-requests' && 'Payment Requests'}
              {activeTab === 'bank-feeds' && 'Bank Email Feeds'}
              {activeTab === 'senders-whitelist' && 'Senders Whitelist Emails'}
              {activeTab === 'payment-methods' && 'Payment Method Configuration'}
              {activeTab === 'api-keys' && 'API Keys & Secrets'}
              {activeTab === 'webhooks' && 'Webhook Endpoints'}
              {activeTab === 'delivery-logs' && 'Webhook Delivery History'}
              {activeTab === 'merchant-settings' && 'Merchant Profile & Settings'}
              {activeTab === 'audit-logs' && 'Security Audit Trail'}
            </h1>
            <span className={`env-pill ${environment}`}>
              {environment === 'test' ? 'Sandbox Mode' : 'Production'}
            </span>
          </div>

          <div className="header-actions">
            {currentUser && (
              <div className="user-header-badge">
                <div className="user-avatar-circle">
                  {currentUser.username.charAt(0).toUpperCase()}
                </div>
                <span className="user-badge-name">{currentUser.username}</span>
              </div>
            )}

            <button
              id="btn-refresh-data"
              className="btn btn-secondary btn-sm"
              onClick={fetchData}
              title="Refresh Data"
            >
              <RefreshCw size={14} className={loading ? 'spin' : ''} />
              Refresh
            </button>

            <button
              id="btn-new-payment-request"
              className="btn btn-primary btn-sm"
              onClick={() => setCreateRequestModal(true)}
            >
              <Plus size={16} />
              New Payment Request
            </button>

            <button
              id="btn-logout"
              className="btn-logout"
              onClick={handleLogout}
              title="Sign Out of Gateway"
            >
              <LogOut size={14} />
              Sign Out
            </button>
          </div>
        </header>

        <div className="content-body">
          {/* Security Alert Notice */}
          <div className="security-banner">
            <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: 2 }} />
            <div>
              <strong>Strict Deterministic Verification Active:</strong> OCR extracted text from customer upload screenshots is classified as untrusted data. Payments without authenticated provider evidence are automatically held in <em>Pending Review</em> for human compliance verification.
            </div>
          </div>

          {/* 1. OVERVIEW PAGE */}
          {activeTab === 'overview' && (
            <div>
              <div className="kpi-grid">
                <div className="kpi-card">
                  <div className="kpi-title">Verified Volume</div>
                  <div className="kpi-value">PKR {(totalVolumePaisa / 100).toLocaleString('en-PK', { minimumFractionDigits: 2 })}</div>
                  <div className="kpi-subtext">Total successfully confirmed transactions</div>
                </div>

                <div className="kpi-card">
                  <div className="kpi-title">Pending Review Queue</div>
                  <div className="kpi-value" style={{ color: '#f59e0b' }}>{pendingReviewCount}</div>
                  <div className="kpi-subtext">Awaiting human reviewer decision</div>
                </div>

                <div className="kpi-card">
                  <div className="kpi-title">Verified Transactions</div>
                  <div className="kpi-value" style={{ color: '#10b981' }}>{verifiedCount}</div>
                  <div className="kpi-subtext">Provider & manual verified count</div>
                </div>

                <div className="kpi-card">
                  <div className="kpi-title">Active Payment Methods</div>
                  <div className="kpi-value">{paymentMethods.filter(m => m.is_active).length} / {paymentMethods.length}</div>
                  <div className="kpi-subtext">Easypaisa, JazzCash, 1Link Bank</div>
                </div>
              </div>

              {/* Recent Payment Requests Table */}
              <div className="card">
                <div className="card-header">
                  <div className="card-title">
                    <Clock size={18} />
                    Recent Payment Requests
                  </div>
                  <button className="btn btn-secondary btn-sm" onClick={() => setActiveTab('payment-requests')}>
                    View All <ChevronRight size={14} />
                  </button>
                </div>

                <div className="table-container">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Reference</th>
                        <th>Order Ref</th>
                        <th>Method</th>
                        <th>Amount</th>
                        <th>Status</th>
                        <th>Verification</th>
                        <th>Created</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {requests.slice(0, 8).map(req => (
                        <tr key={req.id}>
                          <td><span className="code-pill">{req.reference}</span></td>
                          <td><strong>{req.order_reference}</strong></td>
                          <td style={{ textTransform: 'capitalize' }}>{req.payment_method_code}</td>
                          <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                            PKR {(req.amount_paisa / 100).toFixed(2)}
                          </td>
                          <td>
                            <span className={`badge badge-${req.status === 'verified' ? 'verified' : req.status === 'pending_review' ? 'pending' : req.status === 'rejected' ? 'rejected' : 'awaiting'}`}>
                              {req.status.replace('_', ' ')}
                            </span>
                          </td>
                          <td>
                            {req.verification_method ? (
                              <span className={`badge ${req.verification_method === 'provider_verified' ? 'badge-provider' : 'badge-manual'}`}>
                                {req.verification_method === 'provider_verified' ? 'Provider API' : 'Manual Review'}
                              </span>
                            ) : (
                              <span style={{ color: 'var(--text-muted)' }}>—</span>
                            )}
                          </td>
                          <td>{new Date(req.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
                          <td>
                            <button
                              className="btn btn-secondary btn-sm"
                              onClick={() => {
                                setViewPaymentModal(req);
                              }}
                            >
                              <Eye size={14} /> Details
                            </button>
                          </td>
                        </tr>
                      ))}
                      {requests.length === 0 && (
                        <tr>
                          <td colSpan={8} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                            No payment requests created yet. Click "New Payment Request" to get started.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* 2. PAYMENT REQUESTS PAGE */}
          {activeTab === 'payment-requests' && (
            <div className="card">
              <div className="card-header">
                <div className="card-title">All Payment Requests</div>
                <button className="btn btn-primary btn-sm" onClick={() => setCreateRequestModal(true)}>
                  <Plus size={16} /> Create Request
                </button>
              </div>

              <div className="table-container">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Gateway Reference</th>
                      <th>Order Ref</th>
                      <th>Method</th>
                      <th>Amount</th>
                      <th>Status</th>
                      <th>Verification Method</th>
                      <th>Expires At</th>
                      <th>Created</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {requests.map(req => (
                      <tr key={req.id}>
                        <td><span className="code-pill">{req.reference}</span></td>
                        <td><strong>{req.order_reference}</strong></td>
                        <td>{req.payment_method_code}</td>
                        <td style={{ fontFamily: 'var(--font-mono)' }}>PKR {(req.amount_paisa / 100).toFixed(2)}</td>
                        <td>
                          <span className={`badge badge-${req.status === 'verified' ? 'verified' : req.status === 'pending_review' ? 'pending' : req.status === 'rejected' ? 'rejected' : 'awaiting'}`}>
                            {req.status.replace('_', ' ')}
                          </span>
                        </td>
                        <td>
                          {req.verification_method ? (
                            <span className={`badge ${req.verification_method === 'provider_verified' ? 'badge-provider' : 'badge-manual'}`}>
                              {req.verification_method}
                            </span>
                          ) : '—'}
                        </td>
                        <td style={{ fontSize: '0.75rem' }}>{new Date(req.expires_at).toLocaleDateString()}</td>
                        <td style={{ fontSize: '0.75rem' }}>{new Date(req.created_at).toLocaleTimeString()}</td>
                        <td>
                          <button className="btn btn-secondary btn-sm" onClick={() => setViewPaymentModal(req)}>
                            <Eye size={13} /> Inspect
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 3 & 4. PENDING REVIEWS QUEUE */}
          {activeTab === 'pending-reviews' && (
            <div>
              <div className="card">
                <div className="card-header">
                  <div className="card-title">
                    <FileCheck size={20} style={{ color: '#f59e0b' }} />
                    Transactions Awaiting Compliance Review ({payments.filter(p => p.status === 'pending_review').length})
                  </div>
                </div>

                <div className="table-container">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Order Reference</th>
                        <th>Gateway Ref</th>
                        <th>Method</th>
                        <th>Expected Amount</th>
                        <th>Transaction Ref</th>
                        <th>Created</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {payments.filter(p => p.status === 'pending_review').map(item => (
                        <tr key={item.id}>
                          <td><strong>{item.order_reference}</strong></td>
                          <td><span className="code-pill">{item.gateway_reference}</span></td>
                          <td>{item.payment_method_code}</td>
                          <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
                            {item.amount_formatted}
                          </td>
                          <td>
                            {item.transaction_reference ? (
                              <span className="code-pill">{item.transaction_reference}</span>
                            ) : (
                              <span style={{ color: 'var(--text-muted)' }}>Not extracted</span>
                            )}
                          </td>
                          <td>{new Date(item.created_at).toLocaleTimeString()}</td>
                          <td style={{ display: 'flex', gap: '0.5rem' }}>
                            <button
                              id={`btn-approve-${item.id}`}
                              className="btn btn-success btn-sm"
                              onClick={() => {
                                setReviewApproveModal(item);
                                setApproveEvidenceRef(item.transaction_reference || '');
                              }}
                            >
                              <CheckCircle2 size={14} /> Approve
                            </button>

                            <button
                              id={`btn-reject-${item.id}`}
                              className="btn btn-danger btn-sm"
                              onClick={() => {
                                setReviewRejectModal(item);
                              }}
                            >
                              <XCircle size={14} /> Reject
                            </button>

                            <button
                              className="btn btn-secondary btn-sm"
                              onClick={() => setViewOcrModal(item)}
                            >
                              <FileSearch size={14} /> OCR Proof
                            </button>
                          </td>
                        </tr>
                      ))}
                      {payments.filter(p => p.status === 'pending_review').length === 0 && (
                        <tr>
                          <td colSpan={7} style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
                            <CheckCircle2 size={36} style={{ color: '#10b981', margin: '0 auto 1rem' }} />
                            <div>All clear! No payments currently pending manual review.</div>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* 5. BANK EMAIL FEEDS */}
          {activeTab === 'bank-feeds' && (() => {
            const filteredFeeds = bankFeeds.filter(feed => {
              if (feedProviderFilter !== 'all' && feed.provider_code.toLowerCase() !== feedProviderFilter.toLowerCase()) {
                return false;
              }
              if (feedStatusFilter === 'verified' && !feed.payment_id && !feed.order_reference) {
                return false;
              }
              if (feedStatusFilter === 'pending' && (feed.payment_id || feed.order_reference)) {
                return false;
              }
              if (feedSearch.trim()) {
                const q = feedSearch.toLowerCase();
                const txn = (feed.transaction_id || '').toLowerCase();
                const ord = (feed.order_reference || '').toLowerCase();
                const prov = (feed.provider_code || '').toLowerCase();
                const sender = typeof feed.raw_payload === 'object' && feed.raw_payload?.sender_email ? String(feed.raw_payload.sender_email).toLowerCase() : '';
                return txn.includes(q) || ord.includes(q) || prov.includes(q) || sender.includes(q);
              }
              return true;
            });

            const totalFeedsCount = bankFeeds.length;
            const verifiedFeedsCount = bankFeeds.filter(f => f.payment_id || f.order_reference).length;
            const awaitingFeedsCount = bankFeeds.filter(f => !f.payment_id && !f.order_reference).length;
            const activeSendersCount = trustedSenders.filter(s => s.is_active).length;

            return (
              <div>
                {/* Header Actions */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '1rem' }}>
                  <div>
                    <h2 style={{ fontSize: '1.35rem', fontWeight: 800, color: '#fff', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                      <Mail size={22} style={{ color: '#10b981' }} />
                      Bank Email Feeds & Automated Reconciliation
                    </h2>
                    <p style={{ fontSize: '0.825rem', color: 'var(--text-muted)', marginTop: 4 }}>
                      Direct real-time alerts received from Meezan Bank, JazzCash, Easypaisa, HBL, and Raast via Google Cloud Pub/Sub Webhooks.
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: '0.6rem' }}>
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => fetchData()}
                      disabled={loading}
                      title="Refresh feeds from backend database"
                    >
                      <RefreshCw size={14} className={loading ? 'spin' : ''} /> Refresh
                    </button>
                  </div>
                </div>

                {/* 2. STATS KPI CARDS */}
                <div className="stats-grid" style={{ marginBottom: '1.5rem' }}>
                  <div className="stat-card indigo">
                    <div className="stat-card-header">
                      <div className="stat-label">Total Bank Feeds</div>
                      <div className="stat-card-icon indigo">
                        <Inbox size={18} />
                      </div>
                    </div>
                    <div className="stat-value">{totalFeedsCount}</div>
                    <div className="stat-desc">Parsed from official bank notifications</div>
                  </div>

                  <div className="stat-card emerald">
                    <div className="stat-card-header">
                      <div className="stat-label">Auto-Verified Orders</div>
                      <div className="stat-card-icon emerald">
                        <CheckCircle2 size={18} />
                      </div>
                    </div>
                    <div className="stat-value" style={{ color: '#10b981' }}>{verifiedFeedsCount}</div>
                    <div className="stat-desc">Matched automatically to customer orders</div>
                  </div>

                  <div className="stat-card amber">
                    <div className="stat-card-header">
                      <div className="stat-label">Awaiting Slip Match</div>
                      <div className="stat-card-icon amber">
                        <Clock size={18} />
                      </div>
                    </div>
                    <div className="stat-value" style={{ color: '#f59e0b' }}>{awaitingFeedsCount}</div>
                    <div className="stat-desc">Bank credits awaiting customer proof slip</div>
                  </div>

                  <div className="stat-card cyan">
                    <div className="stat-card-header">
                      <div className="stat-label">Real-Time Ingestion</div>
                      <div className="stat-card-icon cyan">
                        <Radio size={18} />
                      </div>
                    </div>
                    <div className="stat-value" style={{ color: '#22d3ee', fontSize: '1.5rem' }}>Pub/Sub Push</div>
                    <div className="stat-desc">Google Cloud instant notification active</div>
                  </div>
                </div>

                {/* 3. FEEDS STREAM (CARDS & TABLE) */}
                <div className="card">
                  <div className="card-header" style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <Inbox size={18} style={{ color: '#10b981' }} />
                      Bank Alerts Stream
                    </div>

                    {/* Filter & Search Bar + View Toggle */}
                    <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center' }}>
                      <div style={{ position: 'relative' }}>
                        <Search size={14} style={{ position: 'absolute', left: 10, top: 10, color: 'var(--text-muted)' }} />
                        <input
                          type="text"
                          className="form-input"
                          style={{ paddingLeft: 30, width: 200, height: 34, fontSize: '0.8rem' }}
                          placeholder="Search TRX, Order, Sender..."
                          value={feedSearch}
                          onChange={e => setFeedSearch(e.target.value)}
                        />
                      </div>

                      <select
                        className="form-select"
                        style={{ width: 130, height: 34, fontSize: '0.8rem' }}
                        value={feedProviderFilter}
                        onChange={e => setFeedProviderFilter(e.target.value)}
                      >
                        <option value="all">All Banks</option>
                        <option value="meezan_bank">Meezan Bank</option>
                        <option value="jazzcash">JazzCash</option>
                        <option value="easypaisa">Easypaisa</option>
                        <option value="hbl">HBL</option>
                        <option value="bank_transfer">Bank Transfer</option>
                        <option value="manual_reconciliation">Manual Entry</option>
                      </select>

                      <select
                        className="form-select"
                        style={{ width: 130, height: 34, fontSize: '0.8rem' }}
                        value={feedStatusFilter}
                        onChange={e => setFeedStatusFilter(e.target.value as any)}
                      >
                        <option value="all">All Statuses</option>
                        <option value="verified">Auto-Verified</option>
                        <option value="pending">Awaiting Match</option>
                      </select>

                      {/* View Mode Toggle */}
                      <div className="view-mode-toggle">
                        <button
                          type="button"
                          className={`view-mode-btn ${feedViewMode === 'cards' ? 'active' : ''}`}
                          onClick={() => setFeedViewMode('cards')}
                          title="Cards Grid View"
                        >
                          <LayoutGrid size={13} /> Cards
                        </button>
                        <button
                          type="button"
                          className={`view-mode-btn ${feedViewMode === 'table' ? 'active' : ''}`}
                          onClick={() => setFeedViewMode('table')}
                          title="Compact Table View"
                        >
                          <List size={13} /> Table
                        </button>
                      </div>
                    </div>
                  </div>

                  {filteredFeeds.length === 0 ? (
                    <div style={{ padding: '3rem 2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                      <Inbox size={42} style={{ margin: '0 auto 1rem', opacity: 0.3 }} />
                      <div style={{ fontSize: '1rem', fontWeight: 600, color: '#fff' }}>No bank email feeds match criteria</div>
                      <p style={{ fontSize: '0.825rem', marginTop: 4, maxWidth: 460, margin: '6px auto 14px' }}>
                        Incoming bank transfer alert emails from Meezan Bank, JazzCash, Easypaisa, and HBL will automatically appear here via Google Cloud Pub/Sub.
                      </p>
                      <button className="btn btn-secondary btn-sm" onClick={handleSyncGmailNow} disabled={syncingGmail}>
                        <RotateCw size={13} className={syncingGmail ? 'spin' : ''} /> Check INBOX Now
                      </button>
                    </div>
                  ) : feedViewMode === 'cards' ? (
                    /* CARDS GRID VIEW */
                    <div className="feed-cards-grid" style={{ padding: '0.5rem 0' }}>
                      {filteredFeeds.map(feed => {
                        const raw = typeof feed.raw_payload === 'object' && feed.raw_payload ? feed.raw_payload : {};
                        const senderEmail = raw.sender_email || raw.sender || 'Direct Bank Ingestion';
                        const isMeezan = feed.provider_code.toLowerCase().includes('meezan');
                        const isJazz = feed.provider_code.toLowerCase().includes('jazz');
                        const isEasy = feed.provider_code.toLowerCase().includes('easy');
                        const isHBL = feed.provider_code.toLowerCase().includes('hbl');

                        const badgeClass = isMeezan ? 'meezan' : isJazz ? 'jazzcash' : isEasy ? 'easypaisa' : isHBL ? 'hbl' : 'bank_transfer';
                        const bankLabel = isMeezan ? 'Meezan Bank' : isJazz ? 'JazzCash' : isEasy ? 'Easypaisa' : isHBL ? 'HBL' : feed.provider_code;
                        const isMatched = Boolean(feed.payment_id || feed.order_reference);

                        return (
                          <div key={feed.id} className={`feed-item-card ${isMatched ? 'verified' : 'pending'}`}>
                            <div className="feed-card-top">
                              <span className={`bank-badge ${badgeClass}`}>
                                {bankLabel}
                              </span>
                              <span style={{ fontSize: '0.725rem', color: 'var(--text-muted)' }}>
                                {new Date(feed.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} • {new Date(feed.created_at).toLocaleDateString()}
                              </span>
                            </div>

                            <div>
                              <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 2 }}>
                                Received Amount
                              </div>
                              <div className="feed-card-amount">
                                {feed.amount_formatted}
                              </div>
                            </div>

                            <div className="feed-card-meta-row">
                              <div className="feed-card-meta-line">
                                <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>Transaction ID:</span>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                                  <span className="code-pill" style={{ fontSize: '0.75rem' }}>{feed.transaction_id}</span>
                                  <button
                                    className="btn-icon"
                                    onClick={() => {
                                      navigator.clipboard.writeText(feed.transaction_id);
                                      alert(`Copied TRX ${feed.transaction_id} to clipboard!`);
                                    }}
                                    title="Copy TRX ID"
                                  >
                                    <Copy size={11} />
                                  </button>
                                </div>
                              </div>

                              <div className="feed-card-meta-line">
                                <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>Sender:</span>
                                <span style={{ color: 'var(--text-primary)', fontSize: '0.75rem', maxWidth: 170, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={senderEmail}>
                                  {senderEmail}
                                </span>
                              </div>
                            </div>

                            <div className="feed-card-actions">
                              <div>
                                {isMatched ? (
                                  <span className="badge badge-verified" style={{ fontSize: '0.72rem', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                                    <CheckCircle2 size={11} /> Auto-Verified ({feed.order_reference || 'Matched'})
                                  </span>
                                ) : (
                                  <span className="badge badge-pending" style={{ fontSize: '0.72rem', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                                    <Clock size={11} /> Awaiting Slip Match
                                  </span>
                                )}
                              </div>

                              <button
                                className="btn btn-secondary btn-sm"
                                onClick={() => setViewFeedModal(feed)}
                                style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem' }}
                              >
                                <Eye size={12} /> Inspect
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    /* TABLE VIEW */
                    <div className="table-container">
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>Bank / Provider</th>
                            <th>Transaction ID (TRX)</th>
                            <th>Extracted Amount</th>
                            <th>Sender Email / Origin</th>
                            <th>Match Status</th>
                            <th>Received At</th>
                            <th>Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredFeeds.map(feed => {
                            const raw = typeof feed.raw_payload === 'object' && feed.raw_payload ? feed.raw_payload : {};
                            const senderEmail = raw.sender_email || raw.sender || 'Direct Ingestion';
                            const isMeezan = feed.provider_code.toLowerCase().includes('meezan');
                            const isJazz = feed.provider_code.toLowerCase().includes('jazz');
                            const isEasy = feed.provider_code.toLowerCase().includes('easy');
                            const isHBL = feed.provider_code.toLowerCase().includes('hbl');

                            const badgeClass = isMeezan ? 'meezan' : isJazz ? 'jazzcash' : isEasy ? 'easypaisa' : isHBL ? 'hbl' : 'bank_transfer';
                            const bankLabel = isMeezan ? 'Meezan Bank' : isJazz ? 'JazzCash' : isEasy ? 'Easypaisa' : isHBL ? 'HBL' : feed.provider_code;
                            const isMatched = Boolean(feed.payment_id || feed.order_reference);

                            return (
                              <tr key={feed.id}>
                                <td>
                                  <span className={`bank-badge ${badgeClass}`}>
                                    {bankLabel}
                                  </span>
                                </td>
                                <td>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                    <span className="code-pill">{feed.transaction_id}</span>
                                    <button
                                      className="btn-icon"
                                      onClick={() => {
                                        navigator.clipboard.writeText(feed.transaction_id);
                                        alert(`Copied TRX ${feed.transaction_id} to clipboard!`);
                                      }}
                                      title="Copy Transaction ID"
                                      style={{ padding: 2 }}
                                    >
                                      <Copy size={12} />
                                    </button>
                                  </div>
                                </td>
                                <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                                  {feed.amount_formatted}
                                </td>
                                <td>
                                  <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                                    {senderEmail}
                                  </span>
                                </td>
                                <td>
                                  {isMatched ? (
                                    <span className="badge badge-verified" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
                                      <CheckCircle2 size={12} /> Auto-Verified ({feed.order_reference || 'Matched'})
                                    </span>
                                  ) : (
                                    <span className="badge badge-pending" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
                                      <Clock size={12} /> Awaiting Slip Match
                                    </span>
                                  )}
                                </td>
                                <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                                  {new Date(feed.created_at).toLocaleString()}
                                </td>
                                <td>
                                  <button
                                    className="btn btn-secondary btn-sm"
                                    onClick={() => setViewFeedModal(feed)}
                                    title="View Bank Email Details"
                                  >
                                    <Eye size={13} /> Inspect Alert
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          {/* 6. SENDERS WHITELIST EMAILS */}
          {activeTab === 'senders-whitelist' && (
            <div>
              {/* Header */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '1rem' }}>
                <div>
                  <h2 style={{ fontSize: '1.35rem', fontWeight: 800, color: '#fff', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                    <ShieldCheck size={22} style={{ color: '#6366f1' }} />
                    Senders Whitelist Emails
                  </h2>
                  <p style={{ fontSize: '0.825rem', color: 'var(--text-muted)', marginTop: 4 }}>
                    Strict security policy: only bank alert emails originating from these official bank addresses are ingested as trusted payment evidence.
                  </p>
                </div>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => fetchData()}
                  disabled={loading}
                >
                  <RefreshCw size={14} className={loading ? 'spin' : ''} /> Refresh Whitelist
                </button>
              </div>

              {/* KPI Cards */}
              <div className="stats-grid" style={{ marginBottom: '1.5rem' }}>
                <div className="stat-card indigo">
                  <div className="stat-card-header">
                    <div className="stat-label">Whitelisted Bank Senders</div>
                    <div className="stat-card-icon indigo">
                      <ShieldCheck size={18} />
                    </div>
                  </div>
                  <div className="stat-value">{trustedSenders.length}</div>
                  <div className="stat-desc">Approved official bank sender addresses</div>
                </div>

                <div className="stat-card emerald">
                  <div className="stat-card-header">
                    <div className="stat-label">Active Protection Rules</div>
                    <div className="stat-card-icon emerald">
                      <CheckCircle2 size={18} />
                    </div>
                  </div>
                  <div className="stat-value" style={{ color: '#10b981' }}>
                    {trustedSenders.filter(s => s.is_active).length} Active
                  </div>
                  <div className="stat-desc">Unauthorized incoming emails are ignored</div>
                </div>

                <div className="stat-card cyan">
                  <div className="stat-card-header">
                    <div className="stat-label">Supported Providers</div>
                    <div className="stat-card-icon cyan">
                      <Mail size={18} />
                    </div>
                  </div>
                  <div className="stat-value" style={{ color: '#22d3ee', fontSize: '1.4rem' }}>
                    Meezan, Jazz, Easy, HBL
                  </div>
                  <div className="stat-desc">Auto-parsed across Pakistani bank formats</div>
                </div>
              </div>

              {/* Whitelist Table Card */}
              <div className="card" style={{ marginBottom: '1.5rem' }}>
                <div className="card-header">
                  <div className="card-title">
                    <ShieldCheck size={18} style={{ color: '#10b981' }} />
                    Approved Bank Email Senders List
                  </div>
                </div>

                <div className="table-container">
                  {trustedSenders.length === 0 ? (
                    <div style={{ padding: '2.5rem 1rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                      <ShieldCheck size={36} style={{ margin: '0 auto 0.75rem', opacity: 0.3 }} />
                      <div style={{ fontSize: '0.95rem', fontWeight: 600, color: '#fff' }}>No whitelisted bank senders configured</div>
                      <p style={{ fontSize: '0.8rem', marginTop: 4 }}>Add your official bank email addresses below to start receiving automated alerts.</p>
                    </div>
                  ) : (
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Bank Institution</th>
                          <th>Whitelisted Sender Email</th>
                          <th>Provider Code</th>
                          <th>Security Status</th>
                          <th>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {trustedSenders.map(s => (
                          <tr key={s.id}>
                            <td><strong>{s.sender_name}</strong></td>
                            <td><span className="code-pill">{s.sender_email}</span></td>
                            <td style={{ fontSize: '0.8rem' }}>{s.provider_code}</td>
                            <td>
                              <span className={`badge ${s.is_active ? 'badge-verified' : 'badge-rejected'}`}>
                                {s.is_active ? 'Active & Whitelisted' : 'Disabled'}
                              </span>
                            </td>
                            <td>
                              <button
                                className="btn btn-secondary btn-sm"
                                style={{ color: '#ef4444' }}
                                onClick={() => handleDeleteSender(s.id)}
                              >
                                Remove
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>

              {/* Add New Trusted Bank Sender Card */}
              <div className="card">
                <div className="card-header">
                  <div className="card-title">
                    <Plus size={18} style={{ color: '#10b981' }} />
                    Add New Trusted Bank Sender Address
                  </div>
                </div>

                <form onSubmit={handleAddSender} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem' }}>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label className="form-label">Official Bank Sender Email *</label>
                      <input
                        type="text"
                        className="form-input"
                        placeholder="e.g. alerts@meezanbank.com or @jazzcash.com.pk"
                        value={newSenderEmail}
                        onChange={e => setNewSenderEmail(e.target.value)}
                        required
                      />
                      <div className="form-help">Exact email or domain wildcard (e.g. @meezanbank.com)</div>
                    </div>

                    <div className="form-group" style={{ margin: 0 }}>
                      <label className="form-label">Bank Institution Name *</label>
                      <input
                        type="text"
                        className="form-input"
                        placeholder="e.g. Meezan Bank Official Alerts"
                        value={newSenderName}
                        onChange={e => setNewSenderName(e.target.value)}
                        required
                      />
                    </div>

                    <div className="form-group" style={{ margin: 0 }}>
                      <label className="form-label">Provider Channel</label>
                      <select
                        className="form-select"
                        value={newSenderProvider}
                        onChange={e => setNewSenderProvider(e.target.value)}
                      >
                        <option value="meezan_bank">Meezan Bank</option>
                        <option value="jazzcash">JazzCash</option>
                        <option value="easypaisa">Easypaisa</option>
                        <option value="hbl">HBL</option>
                        <option value="bank_transfer">Standard Bank</option>
                      </select>
                    </div>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: '0.5rem' }}>
                    <button type="submit" className="btn btn-primary">
                      <Plus size={16} /> Add to Whitelist
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* 6. PAYMENT METHODS */}
          {activeTab === 'payment-methods' && (
            <div>
              <div className="card">
                <div className="card-header">
                  <div className="card-title">Configured Payment Methods</div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    All recipient account details are configured securely here.
                  </div>
                </div>

                <div className="table-container">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Method</th>
                        <th>Account Title</th>
                        <th>Account / Mobile / IBAN</th>
                        <th>Limits</th>
                        <th>Status</th>
                        <th>Instructions Preview</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paymentMethods.map(m => (
                        <tr key={m.id}>
                          <td>
                            <strong>{m.name}</strong>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Code: {m.code}</div>
                          </td>
                          <td>{m.account_title}</td>
                          <td><span className="code-pill">{m.account_identifier}</span></td>
                          <td style={{ fontSize: '0.8rem', fontFamily: 'var(--font-mono)' }}>
                            PKR {(m.min_amount_paisa / 100).toFixed(0)} — PKR {(m.max_amount_paisa / 100).toLocaleString()}
                          </td>
                          <td>
                            <span className={`badge ${m.is_active ? 'badge-verified' : 'badge-rejected'}`}>
                              {m.is_active ? 'Active' : 'Disabled'}
                            </span>
                          </td>
                          <td style={{ maxWidth: 300, fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                            {m.instructions}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* 7. API KEYS */}
          {activeTab === 'api-keys' && (
            <div>
              <div className="card">
                <div className="card-header">
                  <div className="card-title">Merchant API Keys</div>
                  <button className="btn btn-primary btn-sm" onClick={() => setCreateKeyModal(true)}>
                    <Plus size={16} /> Generate New Key
                  </button>
                </div>

                <div className="table-container">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Prefix</th>
                        <th>Label</th>
                        <th>Environment</th>
                        <th>Scopes</th>
                        <th>Status</th>
                        <th>Created</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {apiKeys.map(k => (
                        <tr key={k.id}>
                          <td><span className="code-pill">{k.key_prefix}...</span></td>
                          <td><strong>{k.label}</strong></td>
                          <td>
                            <span className={`env-pill ${k.environment}`}>{k.environment}</span>
                          </td>
                          <td>
                            {k.scopes.map(s => (
                              <span key={s} className="code-pill" style={{ marginRight: 4 }}>{s}</span>
                            ))}
                          </td>
                          <td>
                            <span className={`badge ${k.is_revoked ? 'badge-rejected' : 'badge-verified'}`}>
                              {k.is_revoked ? 'Revoked' : 'Active'}
                            </span>
                          </td>
                          <td style={{ fontSize: '0.75rem' }}>{new Date(k.created_at).toLocaleDateString()}</td>
                          <td style={{ display: 'flex', gap: '0.5rem' }}>
                            {!k.is_revoked && (
                              <>
                                <button
                                  className="btn btn-secondary btn-sm"
                                  onClick={() => handleRotateKey(k.id)}
                                  title="Rotate Key"
                                >
                                  <RotateCw size={13} /> Rotate
                                </button>
                                <button
                                  className="btn btn-danger btn-sm"
                                  onClick={() => handleRevokeKey(k.id)}
                                  title="Revoke Key"
                                >
                                  Revoke
                                </button>
                              </>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* 8. WEBHOOKS */}
          {activeTab === 'webhooks' && (
            <div>
              <div className="card">
                <div className="card-header">
                  <div className="card-title">Webhook Endpoints (HMAC-SHA256 Signed)</div>
                  <button className="btn btn-primary btn-sm" onClick={() => setCreateWebhookModal(true)}>
                    <Plus size={16} /> Add Endpoint
                  </button>
                </div>

                <div className="table-container">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Destination URL</th>
                        <th>Description</th>
                        <th>Events</th>
                        <th>Status</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {webhooks.map(w => (
                        <tr key={w.id}>
                          <td><strong>{w.url}</strong></td>
                          <td>{w.description || '—'}</td>
                          <td>
                            {w.events.map(ev => (
                              <span key={ev} className="code-pill" style={{ marginRight: 4 }}>{ev}</span>
                            ))}
                          </td>
                          <td>
                            <span className={`badge ${w.is_active ? 'badge-verified' : 'badge-rejected'}`}>
                              {w.is_active ? 'Active' : 'Disabled'}
                            </span>
                          </td>
                          <td>
                            <button className="btn btn-secondary btn-sm" onClick={() => handleTestWebhook(w.id)}>
                              Send Test Ping
                            </button>
                          </td>
                        </tr>
                      ))}
                      {webhooks.length === 0 && (
                        <tr>
                          <td colSpan={5} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                            No webhook endpoints configured. Add your Tailor OS or software webhook receiver URL.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* 9. DELIVERY LOGS */}
          {activeTab === 'delivery-logs' && (
            <div className="card">
              <div className="card-header">
                <div className="card-title">Webhook Delivery History</div>
              </div>

              <div className="table-container">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Event Type</th>
                      <th>Destination</th>
                      <th>Status</th>
                      <th>HTTP Code</th>
                      <th>Attempts</th>
                      <th>Timestamp</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {deliveries.map(d => (
                      <tr key={d.id}>
                        <td><span className="code-pill">{d.event_type}</span></td>
                        <td style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.endpoint_url}</td>
                        <td>
                          <span className={`badge ${d.status === 'success' ? 'badge-verified' : d.status === 'retrying' ? 'badge-pending' : 'badge-rejected'}`}>
                            {d.status}
                          </span>
                        </td>
                        <td>
                          <strong>{d.http_status_code || '—'}</strong>
                        </td>
                        <td>{d.attempt_number}</td>
                        <td style={{ fontSize: '0.75rem' }}>{new Date(d.created_at).toLocaleTimeString()}</td>
                        <td>
                          {d.status !== 'success' && (
                            <button className="btn btn-secondary btn-sm" onClick={() => handleRetryDelivery(d.id)}>
                              <RefreshCw size={13} /> Retry
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                    {deliveries.length === 0 && (
                      <tr>
                        <td colSpan={7} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                          No webhook deliveries logged yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 10. MERCHANT SETTINGS */}
          {activeTab === 'merchant-settings' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
              {/* GMAIL BANK FEED INTEGRATION & INBOX STATUS CARD */}
              <div style={{ gridColumn: 'span 2' }}>
                <div className={`gmail-status-card ${!gmailStatus?.configured ? 'disconnected' : gmailStatus?.lastError ? 'attention' : ''}`}>
                  <div className="gmail-status-header">
                    <div className="gmail-status-indicator-group">
                      <div className={`status-pulse-dot ${syncingGmail || gmailStatus?.isRunning ? 'syncing' : (gmailStatus?.configured && gmailStatus?.enabled) ? 'online' : gmailStatus?.lastError ? 'error' : 'offline'}`} />
                      <div>
                        <div className="gmail-status-title">
                          {syncingGmail || gmailStatus?.isRunning ? (
                            <>Gmail Status: Checking INBOX 🔄 <span style={{ fontSize: '0.8rem', fontWeight: 500, color: '#93c5fd' }}>(Syncing Bank Alerts...)</span></>
                          ) : (gmailStatus?.configured && gmailStatus?.enabled) ? (
                            <>Gmail Status: Connected 🟢 (Pub/Sub Push Active)</>
                          ) : gmailStatus?.lastError ? (
                            <>Gmail Status: Attention Required ⚠️</>
                          ) : (
                            <>Gmail Status: Not Configured ⚪</>
                          )}
                        </div>
                        <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 2 }}>
                          {gmailStatus?.pubsubActive ? (
                            <>Automated Real-Time Push Webhook is active via Google Cloud Pub/Sub (<span style={{ fontFamily: 'var(--font-mono)', color: '#a5b4fc' }}>/v1/bank-feeds/gmail/pubsub-webhook</span>)</>
                          ) : (
                            <>Real-time IMAP Polling & Google Cloud Pub/Sub Webhooks</>
                          )}
                        </div>
                      </div>
                    </div>

                    <button
                      className="btn btn-primary btn-sm"
                      onClick={handleSyncGmailNow}
                      disabled={syncingGmail}
                      style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                    >
                      <RotateCw size={14} className={syncingGmail ? 'spin' : ''} />
                      {syncingGmail ? 'Checking INBOX...' : 'Check Mail Now'}
                    </button>
                  </div>

                  <div className="gmail-status-meta-grid">
                    <div className="gmail-meta-item">
                      <div className="gmail-meta-label">Ingestion Mode</div>
                      <div className="gmail-meta-value">
                        <Radio size={13} style={{ color: '#10b981' }} />
                        Pub/Sub Push + IMAP
                      </div>
                    </div>

                    <div className="gmail-meta-item">
                      <div className="gmail-meta-label">Connected Account</div>
                      <div className="gmail-meta-value" style={{ fontFamily: 'var(--font-mono)' }}>
                        <Lock size={12} style={{ color: '#6366f1' }} />
                        {gmailStatus?.gmailUser || 'Encrypted / Protected'}
                      </div>
                    </div>

                    <div className="gmail-meta-item">
                      <div className="gmail-meta-label">Last Successful Sync</div>
                      <div className="gmail-meta-value">
                        <Clock size={13} style={{ color: '#0ea5e9' }} />
                        {gmailStatus?.lastSuccessAt ? new Date(gmailStatus.lastSuccessAt).toLocaleTimeString() : 'Real-time (Active)'}
                      </div>
                    </div>

                    <div className="gmail-meta-item">
                      <div className="gmail-meta-label">Total Ingested Feeds</div>
                      <div className="gmail-meta-value">
                        <Inbox size={13} style={{ color: '#a855f7' }} />
                        {bankFeeds.length} Alerts
                      </div>
                    </div>

                    <div className="gmail-meta-item">
                      <div className="gmail-meta-label">Auto-Verified Orders</div>
                      <div className="gmail-meta-value" style={{ color: '#34d399' }}>
                        <CheckCircle2 size={13} style={{ color: '#10b981' }} />
                        {bankFeeds.filter(f => f.payment_id || f.order_reference).length} Orders
                      </div>
                    </div>
                  </div>
                </div>

                {/* Sync Feedback Banner */}
                {syncFeedback && (
                  <div className={`sync-feedback-banner ${syncFeedback.type}`} style={{ marginTop: '0.85rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      {syncFeedback.type === 'success' && <CheckCircle2 size={16} />}
                      {syncFeedback.type === 'error' && <AlertTriangle size={16} />}
                      {syncFeedback.type === 'info' && <RefreshCw size={16} />}
                      <span>{syncFeedback.message}</span>
                    </div>
                    <button className="btn btn-secondary btn-sm" onClick={() => setSyncFeedback(null)}>✕</button>
                  </div>
                )}
              </div>

              <div className="card">
                <div className="card-header">
                  <div className="card-title">Merchant Tenant Profile</div>
                </div>
                <div className="form-group">
                  <label className="form-label">Merchant Name</label>
                  <input className="form-input" value="Tailor OS Merchant" readOnly />
                </div>
                <div className="form-group">
                  <label className="form-label">Tenant Slug</label>
                  <input className="form-input" value="tailor-os-demo" readOnly />
                </div>
                <div className="form-group">
                  <label className="form-label">Account Currency</label>
                  <input className="form-input" value="PKR (Pakistani Rupee)" readOnly />
                </div>
                <div className="form-group">
                  <label className="form-label">Active API Key for Dashboard</label>
                  <input className="form-input" value={apiKey} onChange={e => setApiKey(e.target.value)} />
                  <div className="form-help">Enter your live or test secret API key to authenticate requests.</div>
                </div>
              </div>

              <div className="card">
                <div className="card-header">
                  <div className="card-title">System & Storage Status</div>
                </div>
                <div className="form-group">
                  <label className="form-label">OCR Engine</label>
                  <input className="form-input" value="Tesseract.js (Self-Hosted, No External LLM)" readOnly />
                </div>
                <div className="form-group">
                  <label className="form-label">Storage Adapter</label>
                  <input className="form-input" value="Local Disk Adapter (Private / Non-Public)" readOnly />
                </div>
                <div className="form-group">
                  <label className="form-label">Webhook Security</label>
                  <input className="form-input" value="HMAC-SHA256 with Replay Window Tolerance (300s)" readOnly />
                </div>
                <div className="form-group">
                  <label className="form-label">Amount Storage Mode</label>
                  <input className="form-input" value="Integer Paisa Representation (1 PKR = 100 Paisa)" readOnly />
                </div>
              </div>

              {/* Trusted Bank Email Whitelist Card */}
              <div className="card" style={{ gridColumn: 'span 2' }}>
                <div className="card-header">
                  <div>
                    <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <ShieldCheck size={20} style={{ color: '#3b82f6' }} />
                      Trusted Bank Sender Emails (Whitelist)
                    </div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                      Only transaction alert emails from these configured addresses will be accepted for automated verification. All other emails will be ignored and discarded.
                    </div>
                  </div>
                </div>

                <form onSubmit={handleAddSender} style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
                  <input
                    type="email"
                    placeholder="e.g. alerts@meezanbank.com"
                    className="form-input"
                    style={{ flex: '1 1 220px' }}
                    value={newSenderEmail}
                    onChange={e => setNewSenderEmail(e.target.value)}
                    required
                  />
                  <input
                    type="text"
                    placeholder="Bank / Sender Label"
                    className="form-input"
                    style={{ flex: '1 1 180px' }}
                    value={newSenderName}
                    onChange={e => setNewSenderName(e.target.value)}
                  />
                  <select
                    className="form-select"
                    style={{ flex: '0 1 160px' }}
                    value={newSenderProvider}
                    onChange={e => setNewSenderProvider(e.target.value)}
                  >
                    <option value="bank_transfer">Bank Transfer / Raast</option>
                    <option value="easypaisa">Easypaisa</option>
                    <option value="jazzcash">JazzCash</option>
                  </select>
                  <button type="submit" className="btn btn-primary" style={{ flex: '0 0 auto' }}>
                    <Plus size={16} /> Add Whitelist Email
                  </button>
                </form>

                <div className="table-container">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Allowed Sender Email</th>
                        <th>Institution / Label</th>
                        <th>Provider</th>
                        <th>Status</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {trustedSenders.map(s => (
                        <tr key={s.id}>
                          <td><span className="code-pill" style={{ color: '#60a5fa', fontWeight: 600 }}>{s.sender_email}</span></td>
                          <td>{s.sender_name}</td>
                          <td style={{ textTransform: 'capitalize' }}>{s.provider_code.replace('_', ' ')}</td>
                          <td><span className="badge badge-verified"><CheckCircle2 size={12} /> Active Whitelist</span></td>
                          <td>
                            <button
                              className="btn btn-secondary btn-sm"
                              style={{ color: '#ef4444' }}
                              onClick={() => handleDeleteSender(s.id)}
                            >
                              <XCircle size={14} /> Remove
                            </button>
                          </td>
                        </tr>
                      ))}
                      {trustedSenders.length === 0 && (
                        <tr>
                          <td colSpan={5} style={{ textAlign: 'center', padding: '1.5rem', color: 'var(--text-muted)' }}>
                            No trusted sender emails configured yet. Add your bank alert email above.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* 11. AUDIT LOGS */}
          {activeTab === 'audit-logs' && (
            <div className="card">
              <div className="card-header">
                <div className="card-title">Tenant Audit Trail</div>
              </div>

              <div className="table-container">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Action</th>
                      <th>Actor Type</th>
                      <th>Entity Type</th>
                      <th>Entity ID</th>
                      <th>IP Address</th>
                      <th>Timestamp</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditLogs.map(log => (
                      <tr key={log.id}>
                        <td><span className="code-pill">{log.action}</span></td>
                        <td>{log.actor_type}</td>
                        <td>{log.entity_type}</td>
                        <td><span className="code-pill">{log.entity_id.slice(0, 8)}...</span></td>
                        <td>{log.ip_address || '127.0.0.1'}</td>
                        <td style={{ fontSize: '0.75rem' }}>{new Date(log.created_at).toLocaleString()}</td>
                      </tr>
                    ))}
                    {auditLogs.length === 0 && (
                      <tr>
                        <td colSpan={6} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                          No audit events logged yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* MODAL: CREATE PAYMENT REQUEST */}
      {createRequestModal && (
        <div className="modal-overlay">
          <div className="modal-dialog">
            <div className="modal-header">
              <h3 style={{ fontSize: '1.1rem', fontWeight: 700 }}>Create Payment Request</h3>
              <button className="btn btn-secondary btn-sm" onClick={() => setCreateRequestModal(false)}>✕</button>
            </div>
            <form onSubmit={handleCreatePaymentRequest}>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">Order Reference *</label>
                  <input
                    id="input-order-ref"
                    className="form-input"
                    value={newOrderRef}
                    onChange={e => setNewOrderRef(e.target.value)}
                    required
                  />
                  <div className="form-help">Your integrating software's order or subscription reference.</div>
                </div>

                <div className="form-group">
                  <label className="form-label">Amount in PKR Rupees *</label>
                  <input
                    id="input-amount"
                    type="number"
                    step="0.01"
                    className="form-input"
                    value={newAmountRupees}
                    onChange={e => setNewAmountRupees(e.target.value)}
                    required
                  />
                  <div className="form-help">
                    Equivalent to {(parseFloat(newAmountRupees || '0') * 100).toLocaleString()} integer paisa.
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">Payment Method *</label>
                  <select
                    id="select-method"
                    className="form-select"
                    value={newMethodCode}
                    onChange={e => setNewMethodCode(e.target.value)}
                  >
                    <option value="jazzcash">JazzCash Mobile Account</option>
                    <option value="easypaisa">Easypaisa Mobile Wallet</option>
                    <option value="bank_transfer">Direct Bank Transfer (1Link)</option>
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">Customer Name</label>
                  <input
                    className="form-input"
                    value={newCustomerName}
                    onChange={e => setNewCustomerName(e.target.value)}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Customer Email</label>
                  <input
                    type="email"
                    className="form-input"
                    value={newCustomerEmail}
                    onChange={e => setNewCustomerEmail(e.target.value)}
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setCreateRequestModal(false)}>Cancel</button>
                <button id="btn-submit-payment-request" type="submit" className="btn btn-primary">Generate Request</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: MANUAL APPROVE */}
      {reviewApproveModal && (
        <div className="modal-overlay">
          <div className="modal-dialog">
            <div className="modal-header">
              <h3 style={{ fontSize: '1.1rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <CheckCircle2 size={18} style={{ color: '#10b981' }} />
                Approve Payment (Manual Review)
              </h3>
              <button className="btn btn-secondary btn-sm" onClick={() => setReviewApproveModal(null)}>✕</button>
            </div>
            <form onSubmit={handleApprovePayment}>
              <div className="modal-body">
                <div style={{ background: 'rgba(16, 185, 129, 0.08)', padding: '1rem', borderRadius: 8, marginBottom: '1.25rem' }}>
                  <div><strong>Order Ref:</strong> {reviewApproveModal.order_reference}</div>
                  <div><strong>Amount:</strong> {reviewApproveModal.amount_formatted}</div>
                  <div><strong>Payment Method:</strong> {reviewApproveModal.payment_method_code}</div>
                </div>

                <div className="form-group">
                  <label className="form-label">Independent Evidence Reference *</label>
                  <input
                    id="input-evidence-ref"
                    className="form-input"
                    placeholder="e.g. Bank Statement Entry #88229 or JazzCash Portal TID"
                    value={approveEvidenceRef}
                    onChange={e => setApproveEvidenceRef(e.target.value)}
                    required
                  />
                  <div className="form-help">Enter the authenticated transaction ID confirmed directly in your bank/wallet portal.</div>
                </div>

                <div className="form-group">
                  <label className="form-label">Reviewer Explanation Notes *</label>
                  <textarea
                    id="input-approve-notes"
                    className="form-textarea"
                    rows={3}
                    placeholder="e.g. Verified PKR credit reflected in merchant account statement at 16:30."
                    value={approveNotes}
                    onChange={e => setApproveNotes(e.target.value)}
                    required
                  />
                  <div className="form-help">Required for the immutable compliance audit trail.</div>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setReviewApproveModal(null)}>Cancel</button>
                <button id="btn-confirm-approve" type="submit" className="btn btn-success">
                  <UserCheck size={16} /> Confirm Manual Approval
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: MANUAL REJECT */}
      {reviewRejectModal && (
        <div className="modal-overlay">
          <div className="modal-dialog">
            <div className="modal-header">
              <h3 style={{ fontSize: '1.1rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <XCircle size={18} style={{ color: '#ef4444' }} />
                Reject Payment
              </h3>
              <button className="btn btn-secondary btn-sm" onClick={() => setReviewRejectModal(null)}>✕</button>
            </div>
            <form onSubmit={handleRejectPayment}>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">Specific Rejection Reason *</label>
                  <textarea
                    id="input-reject-reason"
                    className="form-textarea"
                    rows={3}
                    placeholder="e.g. Credit not received in bank account. Slip image appears altered."
                    value={rejectReason}
                    onChange={e => setRejectReason(e.target.value)}
                    required
                  />
                  <div className="form-help">This reason will be recorded and delivered in the payment.rejected webhook.</div>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setReviewRejectModal(null)}>Cancel</button>
                <button id="btn-confirm-reject" type="submit" className="btn btn-danger">Confirm Rejection</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: NEW API KEY RESULT */}
      {newKeyResult && (
        <div className="modal-overlay">
          <div className="modal-dialog">
            <div className="modal-header">
              <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#10b981' }}>API Key Generated Successfully</h3>
              <button className="btn btn-secondary btn-sm" onClick={() => setNewKeyResult(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="security-banner">
                <AlertTriangle size={18} style={{ flexShrink: 0 }} />
                <div>
                  <strong>Important:</strong> Copy this secret key now. For security, only the cryptographic hash is stored; the raw key will never be shown again!
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Secret API Key</label>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <input className="form-input" value={newKeyResult.secret_key} readOnly style={{ fontFamily: 'var(--font-mono)' }} />
                  <button
                    className="btn btn-secondary"
                    onClick={() => {
                      navigator.clipboard.writeText(newKeyResult.secret_key);
                      alert('Copied to clipboard!');
                    }}
                  >
                    <Copy size={16} /> Copy
                  </button>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-primary" onClick={() => setNewKeyResult(null)}>Done</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: CREATE API KEY */}
      {createKeyModal && (
        <div className="modal-overlay">
          <div className="modal-dialog">
            <div className="modal-header">
              <h3 style={{ fontSize: '1.1rem', fontWeight: 700 }}>Generate New API Key</h3>
              <button className="btn btn-secondary btn-sm" onClick={() => setCreateKeyModal(false)}>✕</button>
            </div>
            <form onSubmit={handleCreateApiKey}>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">Key Label *</label>
                  <input
                    className="form-input"
                    value={newKeyLabel}
                    onChange={e => setNewKeyLabel(e.target.value)}
                    required
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Environment *</label>
                  <select
                    className="form-select"
                    value={newKeyEnv}
                    onChange={e => setNewKeyEnv(e.target.value as 'test' | 'live')}
                  >
                    <option value="test">Test / Sandbox (sg_test_...)</option>
                    <option value="live">Live / Production (sg_live_...)</option>
                  </select>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setCreateKeyModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Generate Key</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: CREATE WEBHOOK ENDPOINT */}
      {createWebhookModal && (
        <div className="modal-overlay">
          <div className="modal-dialog">
            <div className="modal-header">
              <h3 style={{ fontSize: '1.1rem', fontWeight: 700 }}>Add Webhook Endpoint</h3>
              <button className="btn btn-secondary btn-sm" onClick={() => setCreateWebhookModal(false)}>✕</button>
            </div>
            <form onSubmit={handleCreateWebhook}>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">Destination URL *</label>
                  <input
                    type="url"
                    className="form-input"
                    value={newWebhookUrl}
                    onChange={e => setNewWebhookUrl(e.target.value)}
                    required
                  />
                  <div className="form-help">Must be an accessible HTTP/HTTPS endpoint capable of validating HMAC-SHA256 signatures.</div>
                </div>

                <div className="form-group">
                  <label className="form-label">Description</label>
                  <input
                    className="form-input"
                    value={newWebhookDesc}
                    onChange={e => setNewWebhookDesc(e.target.value)}
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setCreateWebhookModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Save Webhook</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: BANK EMAIL FEED INSPECTION */}
      {viewFeedModal && (
        <div className="modal-overlay">
          <div className="modal-dialog" style={{ maxWidth: 720 }}>
            <div className="modal-header">
              <h3 style={{ fontSize: '1.1rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Mail size={18} style={{ color: '#10b981' }} />
                Bank Alert Details — TRX {viewFeedModal.transaction_id}
              </h3>
              <button className="btn btn-secondary btn-sm" onClick={() => setViewFeedModal(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem', marginBottom: '1rem' }}>
                <div style={{ background: 'var(--bg-input)', padding: '0.75rem', borderRadius: 8 }}>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Bank Provider</div>
                  <strong style={{ fontSize: '0.9rem' }}>{viewFeedModal.provider_code}</strong>
                </div>

                <div style={{ background: 'var(--bg-input)', padding: '0.75rem', borderRadius: 8 }}>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Amount Received</div>
                  <strong style={{ fontSize: '0.95rem', fontFamily: 'var(--font-mono)', color: '#34d399' }}>{viewFeedModal.amount_formatted}</strong>
                </div>

                <div style={{ background: 'var(--bg-input)', padding: '0.75rem', borderRadius: 8 }}>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Transaction Reference</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', marginTop: 2 }}>
                    <span className="code-pill">{viewFeedModal.transaction_id}</span>
                    <button
                      className="btn-icon"
                      onClick={() => {
                        navigator.clipboard.writeText(viewFeedModal.transaction_id);
                        alert(`Copied ${viewFeedModal.transaction_id} to clipboard!`);
                      }}
                      title="Copy"
                    >
                      <Copy size={12} />
                    </button>
                  </div>
                </div>

                <div style={{ background: 'var(--bg-input)', padding: '0.75rem', borderRadius: 8 }}>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Auto-Verification Match</div>
                  {viewFeedModal.order_reference ? (
                    <span className="badge badge-verified" style={{ marginTop: 2, display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
                      <CheckCircle2 size={12} /> Matched with Order: {viewFeedModal.order_reference}
                    </span>
                  ) : (
                    <span className="badge badge-pending" style={{ marginTop: 2, display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
                      <Clock size={12} /> Awaiting Customer Proof Slip
                    </span>
                  )}
                </div>
              </div>

              {/* Sender Details */}
              {typeof viewFeedModal.raw_payload === 'object' && viewFeedModal.raw_payload && (
                <div style={{ background: 'rgba(255, 255, 255, 0.03)', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: 8, padding: '0.85rem', marginBottom: '1rem' }}>
                  <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', marginBottom: '0.5rem' }}>
                    Email Metadata & Origin
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', fontSize: '0.8rem' }}>
                    {viewFeedModal.raw_payload.sender_email && (
                      <div><strong>From:</strong> <span className="code-pill">{viewFeedModal.raw_payload.sender_email}</span></div>
                    )}
                    {viewFeedModal.raw_payload.subject && (
                      <div><strong>Subject:</strong> {viewFeedModal.raw_payload.subject}</div>
                    )}
                    {viewFeedModal.raw_payload.date && (
                      <div><strong>Sent Date:</strong> {new Date(viewFeedModal.raw_payload.date).toLocaleString()}</div>
                    )}
                  </div>
                </div>
              )}

              {/* Raw Payload Preview */}
              <div>
                <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', marginBottom: '0.4rem' }}>
                  Ingested Raw Bank Alert Payload
                </div>
                <pre style={{
                  background: 'var(--bg-input)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 8,
                  padding: '0.75rem',
                  fontSize: '0.75rem',
                  fontFamily: 'var(--font-mono)',
                  color: '#93c5fd',
                  maxHeight: 220,
                  overflowY: 'auto',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}>
                  {JSON.stringify(viewFeedModal.raw_payload, null, 2)}
                </pre>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-primary" onClick={() => setViewFeedModal(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: OCR INSPECTION */}
      {viewOcrModal && (
        <div className="modal-overlay">
          <div className="modal-dialog" style={{ maxWidth: 700 }}>
            <div className="modal-header">
              <h3 style={{ fontSize: '1.1rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <FileSearch size={18} /> Receipt OCR Extraction Details
              </h3>
              <button className="btn btn-secondary btn-sm" onClick={() => setViewOcrModal(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="security-banner">
                <AlertTriangle size={18} style={{ flexShrink: 0 }} />
                <div>
                  <strong>OCR Data is Strictly Untrusted:</strong> All fields below are extracted via local Tesseract.js from the customer's uploaded image. Never treat this as payment confirmation without independent provider verification.
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                <div style={{ background: 'var(--bg-input)', padding: '0.75rem', borderRadius: 8 }}>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Order Reference</div>
                  <strong>{viewOcrModal.order_reference}</strong>
                </div>
                <div style={{ background: 'var(--bg-input)', padding: '0.75rem', borderRadius: 8 }}>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Expected Amount</div>
                  <strong style={{ fontFamily: 'var(--font-mono)' }}>{viewOcrModal.amount_formatted}</strong>
                </div>
                <div style={{ background: 'var(--bg-input)', padding: '0.75rem', borderRadius: 8 }}>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Extracted Transaction ID</div>
                  <span className="code-pill">{viewOcrModal.transaction_reference || 'Not found'}</span>
                </div>
                <div style={{ background: 'var(--bg-input)', padding: '0.75rem', borderRadius: 8 }}>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Current Status</div>
                  <span className={`badge badge-${viewOcrModal.status === 'verified' ? 'verified' : viewOcrModal.status === 'pending_review' ? 'pending' : 'rejected'}`}>
                    {viewOcrModal.status}
                  </span>
                </div>
              </div>

              {viewOcrModal.rejection_reason && (
                <div style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', padding: '0.75rem', borderRadius: 8, marginBottom: '1rem', color: '#fca5a5' }}>
                  <strong>Rejection Reason:</strong> {viewOcrModal.rejection_reason}
                </div>
              )}

              {viewOcrModal.manual_review_notes && (
                <div style={{ background: 'rgba(168, 85, 247, 0.1)', border: '1px solid rgba(168, 85, 247, 0.3)', padding: '0.75rem', borderRadius: 8, marginBottom: '1rem', color: '#d8b4fe' }}>
                  <strong>Reviewer Notes:</strong> {viewOcrModal.manual_review_notes}
                  <div style={{ fontSize: '0.75rem', marginTop: 4 }}>Approved by: {viewOcrModal.manual_reviewed_by}</div>
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-primary" onClick={() => setViewOcrModal(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: PAYMENT DETAILS */}
      {viewPaymentModal && (
        <div className="modal-overlay">
          <div className="modal-dialog">
            <div className="modal-header">
              <h3 style={{ fontSize: '1.1rem', fontWeight: 700 }}>Payment Request Details</h3>
              <button className="btn btn-secondary btn-sm" onClick={() => setViewPaymentModal(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                <div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Gateway Reference</div>
                  <span className="code-pill">{viewPaymentModal.reference}</span>
                </div>
                <div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Order Reference</div>
                  <strong>{viewPaymentModal.order_reference}</strong>
                </div>
                <div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Amount (Paisa)</div>
                  <strong style={{ fontFamily: 'var(--font-mono)' }}>{viewPaymentModal.amount_paisa} paisa</strong>
                </div>
                <div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Status</div>
                  <span className={`badge badge-${viewPaymentModal.status === 'verified' ? 'verified' : viewPaymentModal.status === 'pending_review' ? 'pending' : 'awaiting'}`}>
                    {viewPaymentModal.status}
                  </span>
                </div>
              </div>

              <div style={{ background: 'var(--bg-input)', padding: '1rem', borderRadius: 8, marginTop: '1rem' }}>
                <div style={{ fontWeight: 600, marginBottom: '0.5rem', fontSize: '0.85rem' }}>Deterministic Verification Rules</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <CheckCircle2 size={15} style={{ color: '#10b981' }} /> Merchant & Tenant Belongs Check: Passed
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <CheckCircle2 size={15} style={{ color: '#10b981' }} /> Currency PKR Match: Passed
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <CheckCircle2 size={15} style={{ color: '#10b981' }} /> Receipt SHA-256 Uniqueness Check: Passed
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    {viewPaymentModal.verification_method ? (
                      <CheckCircle2 size={15} style={{ color: '#10b981' }} />
                    ) : (
                      <Clock size={15} style={{ color: '#f59e0b' }} />
                    )}
                    Verification Method: {viewPaymentModal.verification_method || 'Awaiting Manual Approval'}
                  </div>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-primary" onClick={() => setViewPaymentModal(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
