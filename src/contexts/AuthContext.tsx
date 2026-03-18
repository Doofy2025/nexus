import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";

export type AppRole = "super_admin" | "tenant_admin" | "operator" | "viewer";

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  isActive: boolean;
  settings: {
    registrationEnabled: boolean;
    sessionTimeoutMinutes: number;
    maxFailedAttempts: number;
    lockoutDurationMinutes: number;
  };
}

export interface Site {
  id: string;
  tenantId: string;
  name: string;
  code: string;
  type: "datacenter" | "cloud" | "edge";
  provider?: string;
  location?: string;
  isActive: boolean;
}

export interface AppUser {
  id: string;
  email: string;
  displayName: string;
  role: AppRole;
  tenantId: string;
  isActive: boolean;
  isLocked: boolean;
  failedAttempts: number;
  lastLogin: string | null;
  createdAt: string;
  mfaEnabled: boolean;
}

export interface AuditLogEntry {
  id: string;
  userId: string;
  userEmail: string;
  action: string;
  resource: string;
  details: string;
  ipAddress: string;
  timestamp: string;
  severity: "info" | "warning" | "critical";
}

interface AuthState {
  user: AppUser | null;
  tenant: Tenant | null;
  isAuthenticated: boolean;
  isLoading: boolean;
}

interface AuthContextType extends AuthState {
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
  register: (email: string, password: string, displayName: string) => Promise<{ success: boolean; error?: string }>;
  tenants: Tenant[];
  users: AppUser[];
  sites: Site[];
  auditLog: AuditLogEntry[];
  switchTenant: (tenantId: string) => void;
  updateTenantSettings: (tenantId: string, settings: Partial<Tenant["settings"]>) => void;
  createTenant: (name: string, slug: string) => void;
  deleteTenant: (tenantId: string) => void;
  createSite: (site: Omit<Site, "id">) => void;
  deleteSite: (siteId: string) => void;
  toggleSiteActive: (siteId: string) => void;
  createUser: (user: Omit<AppUser, "id" | "createdAt" | "failedAttempts" | "isLocked" | "lastLogin">) => void;
  updateUserRole: (userId: string, role: AppRole) => void;
  toggleUserActive: (userId: string) => void;
  unlockUser: (userId: string) => void;
  deleteUser: (userId: string) => void;
  hasRole: (role: AppRole | AppRole[]) => boolean;
  sessionTimeLeft: number;
  resetSessionTimer: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

// Default demo data
const DEFAULT_TENANTS: Tenant[] = [
  {
    id: "t1",
    name: "Vanguard Corp",
    slug: "vanguard",
    createdAt: "2024-01-15T00:00:00Z",
    isActive: true,
    settings: {
      registrationEnabled: true,
      sessionTimeoutMinutes: 30,
      maxFailedAttempts: 5,
      lockoutDurationMinutes: 15,
    },
  },
  {
    id: "t2",
    name: "Acme Industries",
    slug: "acme",
    createdAt: "2024-03-10T00:00:00Z",
    isActive: true,
    settings: {
      registrationEnabled: false,
      sessionTimeoutMinutes: 15,
      maxFailedAttempts: 3,
      lockoutDurationMinutes: 30,
    },
  },
];

const DEFAULT_SITES: Site[] = [
  { id: "s1", tenantId: "t1", name: "Austin Datacenter", code: "ADC", type: "datacenter", location: "Austin, TX", isActive: true },
  { id: "s2", tenantId: "t1", name: "San Angelo Datacenter", code: "SDC", type: "datacenter", location: "San Angelo, TX", isActive: true },
  { id: "s3", tenantId: "t1", name: "Amazon Web Services", code: "AWS", type: "cloud", provider: "AWS", isActive: true },
  { id: "s4", tenantId: "t1", name: "Microsoft Azure", code: "AZURE", type: "cloud", provider: "Azure", isActive: true },
  { id: "s5", tenantId: "t1", name: "Google Cloud Platform", code: "GCP", type: "cloud", provider: "GCP", isActive: true },
  { id: "s6", tenantId: "t1", name: "LDC Annex", code: "LDC-ANNEX", type: "datacenter", location: "Austin, TX", isActive: true },
  { id: "s7", tenantId: "t1", name: "LDC Mopac", code: "LDC-MOPAC", type: "datacenter", location: "Austin, TX", isActive: true },
  { id: "s8", tenantId: "t2", name: "Acme Primary DC", code: "ACME-DC1", type: "datacenter", location: "Dallas, TX", isActive: true },
  { id: "s9", tenantId: "t2", name: "AWS US-East", code: "AWS-E1", type: "cloud", provider: "AWS", isActive: true },
];

const DEFAULT_USERS: AppUser[] = [
  { id: "u1", email: "superadmin@vanguardos.io", displayName: "System Admin", role: "super_admin", tenantId: "t1", isActive: true, isLocked: false, failedAttempts: 0, lastLogin: "2026-03-16T08:00:00Z", createdAt: "2024-01-15T00:00:00Z", mfaEnabled: true },
  { id: "u2", email: "admin@vanguard.com", displayName: "Tenant Admin", role: "tenant_admin", tenantId: "t1", isActive: true, isLocked: false, failedAttempts: 0, lastLogin: "2026-03-15T14:30:00Z", createdAt: "2024-02-01T00:00:00Z", mfaEnabled: true },
  { id: "u3", email: "operator@vanguard.com", displayName: "NOC Operator", role: "operator", tenantId: "t1", isActive: true, isLocked: false, failedAttempts: 0, lastLogin: "2026-03-16T06:00:00Z", createdAt: "2024-03-01T00:00:00Z", mfaEnabled: false },
  { id: "u4", email: "viewer@vanguard.com", displayName: "Read Only User", role: "viewer", tenantId: "t1", isActive: true, isLocked: false, failedAttempts: 2, lastLogin: "2026-03-14T12:00:00Z", createdAt: "2024-04-01T00:00:00Z", mfaEnabled: false },
  { id: "u5", email: "locked@vanguard.com", displayName: "Locked User", role: "operator", tenantId: "t1", isActive: true, isLocked: true, failedAttempts: 5, lastLogin: "2026-03-10T09:00:00Z", createdAt: "2024-05-01T00:00:00Z", mfaEnabled: false },
  { id: "u6", email: "admin@acme.com", displayName: "Acme Admin", role: "tenant_admin", tenantId: "t2", isActive: true, isLocked: false, failedAttempts: 0, lastLogin: "2026-03-16T07:00:00Z", createdAt: "2024-03-10T00:00:00Z", mfaEnabled: true },
];

const DEFAULT_AUDIT_LOG: AuditLogEntry[] = [
  { id: "a1", userId: "u1", userEmail: "superadmin@vanguardos.io", action: "LOGIN", resource: "auth", details: "Successful login", ipAddress: "10.0.1.50", timestamp: "2026-03-16T08:00:00Z", severity: "info" },
  { id: "a2", userId: "u5", userEmail: "locked@vanguard.com", action: "LOGIN_FAILED", resource: "auth", details: "Account locked after 5 failed attempts", ipAddress: "192.168.1.100", timestamp: "2026-03-16T07:55:00Z", severity: "critical" },
  { id: "a3", userId: "u2", userEmail: "admin@vanguard.com", action: "USER_CREATED", resource: "users", details: "Created user viewer@vanguard.com", ipAddress: "10.0.1.51", timestamp: "2026-03-15T14:30:00Z", severity: "info" },
  { id: "a4", userId: "u3", userEmail: "operator@vanguard.com", action: "SITE_MODIFIED", resource: "sites", details: "Disabled site SDC temporarily", ipAddress: "10.0.2.10", timestamp: "2026-03-15T10:00:00Z", severity: "warning" },
  { id: "a5", userId: "unknown", userEmail: "unknown@attacker.com", action: "UNAUTHORIZED_ACCESS", resource: "api", details: "Attempted access to /api/admin from unauthorized IP", ipAddress: "203.0.113.42", timestamp: "2026-03-15T03:22:00Z", severity: "critical" },
  { id: "a6", userId: "u1", userEmail: "superadmin@vanguardos.io", action: "TENANT_CREATED", resource: "tenants", details: "Created tenant Acme Industries", ipAddress: "10.0.1.50", timestamp: "2024-03-10T00:00:00Z", severity: "info" },
  { id: "a7", userId: "u2", userEmail: "admin@vanguard.com", action: "ROLE_CHANGED", resource: "users", details: "Changed role of operator@vanguard.com to operator", ipAddress: "10.0.1.51", timestamp: "2026-03-14T09:15:00Z", severity: "warning" },
  { id: "a8", userId: "unknown", userEmail: "brute@force.net", action: "BRUTE_FORCE_DETECTED", resource: "auth", details: "50 failed login attempts in 5 minutes from single IP", ipAddress: "198.51.100.77", timestamp: "2026-03-14T02:10:00Z", severity: "critical" },
];

let idCounter = 100;
const genId = () => `gen-${++idCounter}`;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [tenants, setTenants] = useState<Tenant[]>(DEFAULT_TENANTS);
  const [users, setUsers] = useState<AppUser[]>(DEFAULT_USERS);
  const [sites, setSites] = useState<Site[]>(DEFAULT_SITES);
  const [auditLog, setAuditLog] = useState<AuditLogEntry[]>(DEFAULT_AUDIT_LOG);
  const [authState, setAuthState] = useState<AuthState>({
    user: null,
    tenant: null,
    isAuthenticated: false,
    isLoading: false,
  });
  const [sessionTimeLeft, setSessionTimeLeft] = useState(1800);
  const [lastActivity, setLastActivity] = useState(Date.now());

  const currentTenant = authState.tenant;
  const timeoutMinutes = currentTenant?.settings.sessionTimeoutMinutes ?? 30;

  // Session timeout countdown
  useEffect(() => {
    if (!authState.isAuthenticated) return;
    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - lastActivity) / 1000);
      const remaining = timeoutMinutes * 60 - elapsed;
      setSessionTimeLeft(Math.max(0, remaining));
      if (remaining <= 0) {
        addAuditEntry(authState.user!, "SESSION_TIMEOUT", "auth", "Session expired due to inactivity", "warning");
        setAuthState({ user: null, tenant: null, isAuthenticated: false, isLoading: false });
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [authState.isAuthenticated, lastActivity, timeoutMinutes]);

  // Reset timer on activity
  useEffect(() => {
    if (!authState.isAuthenticated) return;
    const handler = () => setLastActivity(Date.now());
    window.addEventListener("mousemove", handler);
    window.addEventListener("keydown", handler);
    window.addEventListener("click", handler);
    return () => {
      window.removeEventListener("mousemove", handler);
      window.removeEventListener("keydown", handler);
      window.removeEventListener("click", handler);
    };
  }, [authState.isAuthenticated]);

  const resetSessionTimer = useCallback(() => setLastActivity(Date.now()), []);

  const addAuditEntry = (user: AppUser | null, action: string, resource: string, details: string, severity: AuditLogEntry["severity"] = "info") => {
    setAuditLog(prev => [{
      id: genId(),
      userId: user?.id ?? "unknown",
      userEmail: user?.email ?? "unknown",
      action,
      resource,
      details,
      ipAddress: "127.0.0.1",
      timestamp: new Date().toISOString(),
      severity,
    }, ...prev]);
  };

  const login = async (email: string, password: string): Promise<{ success: boolean; error?: string }> => {
    const user = users.find(u => u.email.toLowerCase() === email.toLowerCase());
    if (!user) {
      addAuditEntry(null, "LOGIN_FAILED", "auth", `Failed login attempt for ${email}`, "warning");
      return { success: false, error: "Invalid credentials" };
    }
    if (user.isLocked) {
      addAuditEntry(user, "LOGIN_BLOCKED", "auth", "Login attempt on locked account", "critical");
      return { success: false, error: "Account is locked. Contact your administrator." };
    }
    if (!user.isActive) {
      return { success: false, error: "Account is disabled." };
    }
    // Demo: password is "password" for all users
    if (password !== "password") {
      const tenant = tenants.find(t => t.id === user.tenantId);
      const maxAttempts = tenant?.settings.maxFailedAttempts ?? 5;
      const newAttempts = user.failedAttempts + 1;
      const shouldLock = newAttempts >= maxAttempts;
      setUsers(prev => prev.map(u => u.id === user.id ? { ...u, failedAttempts: newAttempts, isLocked: shouldLock } : u));
      addAuditEntry(user, "LOGIN_FAILED", "auth", `Failed attempt ${newAttempts}/${maxAttempts}${shouldLock ? " — account locked" : ""}`, shouldLock ? "critical" : "warning");
      return { success: false, error: shouldLock ? `Account locked after ${maxAttempts} failed attempts.` : `Invalid credentials. ${maxAttempts - newAttempts} attempts remaining.` };
    }
    const tenant = tenants.find(t => t.id === user.tenantId)!;
    const updatedUser = { ...user, failedAttempts: 0, lastLogin: new Date().toISOString() };
    setUsers(prev => prev.map(u => u.id === user.id ? updatedUser : u));
    setAuthState({ user: updatedUser, tenant, isAuthenticated: true, isLoading: false });
    setLastActivity(Date.now());
    addAuditEntry(updatedUser, "LOGIN", "auth", "Successful login", "info");
    return { success: true };
  };

  const logout = () => {
    if (authState.user) {
      addAuditEntry(authState.user, "LOGOUT", "auth", "User logged out", "info");
    }
    setAuthState({ user: null, tenant: null, isAuthenticated: false, isLoading: false });
  };

  const register = async (email: string, _password: string, displayName: string): Promise<{ success: boolean; error?: string }> => {
    if (users.find(u => u.email.toLowerCase() === email.toLowerCase())) {
      return { success: false, error: "Email already registered." };
    }
    // Find a tenant with registration enabled (demo: use first)
    const openTenant = tenants.find(t => t.settings.registrationEnabled);
    if (!openTenant) return { success: false, error: "Registration is currently disabled." };
    const newUser: AppUser = {
      id: genId(),
      email,
      displayName,
      role: "viewer",
      tenantId: openTenant.id,
      isActive: true,
      isLocked: false,
      failedAttempts: 0,
      lastLogin: null,
      createdAt: new Date().toISOString(),
      mfaEnabled: false,
    };
    setUsers(prev => [...prev, newUser]);
    addAuditEntry(newUser, "USER_REGISTERED", "auth", `New registration: ${email}`, "info");
    return { success: true };
  };

  const switchTenant = (tenantId: string) => {
    const tenant = tenants.find(t => t.id === tenantId);
    if (tenant) setAuthState(prev => ({ ...prev, tenant }));
  };

  const updateTenantSettings = (tenantId: string, settings: Partial<Tenant["settings"]>) => {
    setTenants(prev => prev.map(t => t.id === tenantId ? { ...t, settings: { ...t.settings, ...settings } } : t));
    if (authState.tenant?.id === tenantId) {
      setAuthState(prev => prev.tenant ? ({ ...prev, tenant: { ...prev.tenant, settings: { ...prev.tenant.settings, ...settings } } }) : prev);
    }
    addAuditEntry(authState.user, "TENANT_SETTINGS_UPDATED", "tenants", `Updated settings for tenant ${tenantId}`, "warning");
  };

  const createTenant = (name: string, slug: string) => {
    const newTenant: Tenant = {
      id: genId(), name, slug, createdAt: new Date().toISOString(), isActive: true,
      settings: { registrationEnabled: true, sessionTimeoutMinutes: 30, maxFailedAttempts: 5, lockoutDurationMinutes: 15 },
    };
    setTenants(prev => [...prev, newTenant]);
    // Add default sites
    const defaultSiteData = [
      { name: "Austin Datacenter", code: "ADC", type: "datacenter" as const, location: "Austin, TX" },
      { name: "San Angelo Datacenter", code: "SDC", type: "datacenter" as const, location: "San Angelo, TX" },
      { name: "Amazon Web Services", code: "AWS", type: "cloud" as const, provider: "AWS" },
      { name: "Microsoft Azure", code: "AZURE", type: "cloud" as const, provider: "Azure" },
      { name: "Google Cloud Platform", code: "GCP", type: "cloud" as const, provider: "GCP" },
      { name: "LDC Annex", code: "LDC-ANNEX", type: "datacenter" as const, location: "Austin, TX" },
      { name: "LDC Mopac", code: "LDC-MOPAC", type: "datacenter" as const, location: "Austin, TX" },
    ];
    const newSites = defaultSiteData.map(s => ({ ...s, id: genId(), tenantId: newTenant.id, isActive: true }));
    setSites(prev => [...prev, ...newSites]);
    addAuditEntry(authState.user, "TENANT_CREATED", "tenants", `Created tenant: ${name}`, "info");
  };

  const deleteTenant = (tenantId: string) => {
    setTenants(prev => prev.filter(t => t.id !== tenantId));
    setSites(prev => prev.filter(s => s.tenantId !== tenantId));
    setUsers(prev => prev.filter(u => u.tenantId !== tenantId));
    addAuditEntry(authState.user, "TENANT_DELETED", "tenants", `Deleted tenant ${tenantId}`, "critical");
  };

  const createSite = (site: Omit<Site, "id">) => {
    setSites(prev => [...prev, { ...site, id: genId() }]);
    addAuditEntry(authState.user, "SITE_CREATED", "sites", `Created site: ${site.name}`, "info");
  };

  const deleteSite = (siteId: string) => {
    const site = sites.find(s => s.id === siteId);
    setSites(prev => prev.filter(s => s.id !== siteId));
    addAuditEntry(authState.user, "SITE_DELETED", "sites", `Deleted site: ${site?.name}`, "warning");
  };

  const toggleSiteActive = (siteId: string) => {
    setSites(prev => prev.map(s => s.id === siteId ? { ...s, isActive: !s.isActive } : s));
  };

  const createUser = (user: Omit<AppUser, "id" | "createdAt" | "failedAttempts" | "isLocked" | "lastLogin">) => {
    setUsers(prev => [...prev, { ...user, id: genId(), createdAt: new Date().toISOString(), failedAttempts: 0, isLocked: false, lastLogin: null }]);
    addAuditEntry(authState.user, "USER_CREATED", "users", `Created user: ${user.email}`, "info");
  };

  const updateUserRole = (userId: string, role: AppRole) => {
    setUsers(prev => prev.map(u => u.id === userId ? { ...u, role } : u));
    addAuditEntry(authState.user, "ROLE_CHANGED", "users", `Changed role of user ${userId} to ${role}`, "warning");
  };

  const toggleUserActive = (userId: string) => {
    setUsers(prev => prev.map(u => u.id === userId ? { ...u, isActive: !u.isActive } : u));
  };

  const unlockUser = (userId: string) => {
    setUsers(prev => prev.map(u => u.id === userId ? { ...u, isLocked: false, failedAttempts: 0 } : u));
    addAuditEntry(authState.user, "USER_UNLOCKED", "users", `Unlocked user ${userId}`, "info");
  };

  const deleteUser = (userId: string) => {
    setUsers(prev => prev.filter(u => u.id !== userId));
    addAuditEntry(authState.user, "USER_DELETED", "users", `Deleted user ${userId}`, "warning");
  };

  const hasRole = (role: AppRole | AppRole[]) => {
    if (!authState.user) return false;
    const roles = Array.isArray(role) ? role : [role];
    // super_admin has all access
    if (authState.user.role === "super_admin") return true;
    return roles.includes(authState.user.role);
  };

  return (
    <AuthContext.Provider value={{
      ...authState, login, logout, register,
      tenants, users, sites, auditLog,
      switchTenant, updateTenantSettings, createTenant, deleteTenant,
      createSite, deleteSite, toggleSiteActive,
      createUser, updateUserRole, toggleUserActive, unlockUser, deleteUser,
      hasRole, sessionTimeLeft, resetSessionTimer,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
