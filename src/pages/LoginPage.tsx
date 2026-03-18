import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { Eye, EyeOff, Shield, AlertTriangle } from "lucide-react";

const LoginPage = () => {
  const { login, register, tenants } = useAuth();
  const navigate = useNavigate();
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);

  const registrationEnabled = tenants.some(t => t.settings.registrationEnabled);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");
    setLoading(true);

    if (isRegister) {
      const result = await register(email, password, displayName);
      if (result.success) {
        setSuccess("Account created. You can now log in.");
        setIsRegister(false);
        setPassword("");
      } else {
        setError(result.error || "Registration failed");
      }
    } else {
      const result = await login(email, password);
      if (result.success) {
        navigate("/");
      } else {
        setError(result.error || "Login failed");
      }
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen flex bg-background">
      {/* Left side - branding */}
      <div className="hidden lg:flex lg:w-1/2 bg-sidebar text-sidebar-foreground flex-col justify-between p-12">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary flex items-center justify-center">
            <span className="text-primary-foreground font-bold text-lg">V</span>
          </div>
          <span className="font-bold text-xl text-sidebar-accent-foreground">Vanguard OS</span>
        </div>
        <div className="space-y-6">
          <h1 className="text-4xl font-bold text-sidebar-accent-foreground leading-tight">
            Enterprise Infrastructure<br />Command Center
          </h1>
          <p className="text-sidebar-muted text-lg max-w-md">
            Unified observability, automation, and security across your entire hybrid infrastructure.
          </p>
          <div className="grid grid-cols-2 gap-4 max-w-sm">
            {[
              "Multi-Tenant",
              "Role-Based Access",
              "Session Security",
              "Audit Logging",
            ].map(f => (
              <div key={f} className="flex items-center gap-2 text-sm text-sidebar-accent-foreground">
                <Shield className="w-4 h-4 text-primary" />
                {f}
              </div>
            ))}
          </div>
        </div>
        <p className="text-xs text-sidebar-muted">
          © 2026 Vanguard OS. Enterprise-grade platform.
        </p>
      </div>

      {/* Right side - form */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-md space-y-8">
          <div className="lg:hidden flex items-center gap-3 justify-center mb-8">
            <div className="w-10 h-10 rounded-lg bg-primary flex items-center justify-center">
              <span className="text-primary-foreground font-bold text-lg">V</span>
            </div>
            <span className="font-bold text-xl text-foreground">Vanguard OS</span>
          </div>

          <div className="text-center">
            <h2 className="text-2xl font-bold text-foreground">
              {isRegister ? "Create Account" : "Welcome Back"}
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              {isRegister ? "Register for platform access" : "Sign in to your account"}
            </p>
          </div>

          {error && (
            <div className="flex items-center gap-2 p-3 rounded-md bg-destructive/10 border border-destructive/20 text-destructive text-sm">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}

          {success && (
            <div className="flex items-center gap-2 p-3 rounded-md bg-success/10 border border-success/20 text-success text-sm">
              <Shield className="w-4 h-4 flex-shrink-0" />
              {success}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {isRegister && (
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">Display Name</label>
                <input
                  type="text"
                  required
                  value={displayName}
                  onChange={e => setDisplayName(e.target.value)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  placeholder="Your name"
                />
              </div>
            )}
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                placeholder="user@company.com"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">Password</label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  required
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 pr-10 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {!isRegister && (
                <p className="text-xs text-muted-foreground mt-1">
                  Demo: use password "<span className="font-mono">password</span>" for any user
                </p>
              )}
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full h-10 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {loading ? "Please wait…" : isRegister ? "Create Account" : "Sign In"}
            </button>
          </form>

          {registrationEnabled && (
            <div className="text-center">
              <button
                onClick={() => { setIsRegister(!isRegister); setError(""); setSuccess(""); }}
                className="text-sm text-primary hover:underline"
              >
                {isRegister ? "Already have an account? Sign in" : "Don't have an account? Register"}
              </button>
            </div>
          )}

          <div className="text-center text-xs text-muted-foreground space-y-1">
            <p>Protected by session timeout and account lockout policies</p>
            <p>All access attempts are logged and monitored</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
