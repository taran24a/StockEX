import {
  ChangePasswordRequestSchema,
  ProfileDetailsResponseSchema,
  ResetVirtualAccountRequestSchema,
  ResetVirtualAccountResponseSchema,
  UpdateProfileRequestSchema,
  UserSchema,
  VirtualResetCooldownResponseSchema,
  VirtualResetCooldownSchema,
  type User
} from "@tradewise/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import { z } from "zod";
import { apiRequest } from "./api";
import { useAuth } from "./auth";

const avatarFileSchema = z.object({
  type: z.enum(["image/jpeg", "image/png", "image/webp"]),
  size: z.number().int().positive().max(2 * 1024 * 1024)
});

function ProfileMessage({ children, error = false }: { children: ReactNode; error?: boolean }) {
  return <p className={`profile-message ${error ? "is-error" : ""}`} role={error ? "alert" : "status"}>{children}</p>;
}

function AvatarEditor({
  avatarUrl,
  displayName,
  uploadAvatar
}: {
  avatarUrl: string | null;
  displayName: string;
  uploadAvatar(file: File): Promise<void>;
}) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => () => {
    if (previewUrl !== null) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  async function selectAvatar(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    event.target.value = "";
    setError(null);
    setMessage(null);
    if (file === undefined) return;
    const parsed = avatarFileSchema.safeParse({ type: file.type, size: file.size });
    if (!parsed.success) {
      setError("Choose a JPEG, PNG, or WebP image no larger than 2 MB.");
      return;
    }
    const nextPreview = URL.createObjectURL(file);
    setPreviewUrl(nextPreview);
    setUploading(true);
    try {
      await uploadAvatar(file);
      setPreviewUrl(null);
      setMessage("Avatar updated.");
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Avatar could not be uploaded.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="profile-avatar-editor">
      <div className="profile-avatar-preview">
        {previewUrl !== null || avatarUrl !== null ? (
          <img alt={`${displayName} avatar preview`} src={previewUrl ?? avatarUrl ?? undefined} />
        ) : (
          <span aria-label={`${displayName} avatar preview`} role="img">{displayName.slice(0, 1).toUpperCase()}</span>
        )}
      </div>
      <div className="profile-avatar-actions">
        <label className="profile-secondary-action">
          {uploading ? "Uploading…" : "Choose avatar"}
          <input
            accept="image/jpeg,image/png,image/webp"
            aria-label="Choose avatar image"
            disabled={uploading}
            onChange={(event) => void selectAvatar(event)}
            type="file"
          />
        </label>
        <p>JPEG, PNG, or WebP · maximum 2 MB</p>
        {error !== null && <ProfileMessage error>{error}</ProfileMessage>}
        {message !== null && <ProfileMessage>{message}</ProfileMessage>}
      </div>
    </div>
  );
}

function DisplayNameForm({ token, user, onUpdated }: { token: string; user: User; onUpdated(user: User): void }) {
  const [name, setName] = useState(user.displayName);
  const [error, setError] = useState<string | null>(null);
  const update = useMutation({
    mutationFn: () => {
      const input = UpdateProfileRequestSchema.parse({ displayName: name });
      return apiRequest("/api/v1/users/me", UserSchema, token, {
        method: "PATCH",
        body: JSON.stringify(input)
      });
    },
    onSuccess: (updatedUser) => {
      onUpdated(updatedUser);
      setName(updatedUser.displayName);
      setError(null);
    },
    onError: (updateError: Error) => setError(updateError.message)
  });

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const result = UpdateProfileRequestSchema.safeParse({ displayName: name });
    setError(result.success ? null : result.error.issues[0]?.message ?? "Enter a valid display name.");
    if (result.success) update.mutate();
  }

  return (
    <form className="profile-form" onSubmit={submit}>
      <label><span>Display name</span>
        <input maxLength={60} minLength={2} onChange={(event) => setName(event.target.value)} value={name} />
      </label>
      {error !== null && <ProfileMessage error>{error}</ProfileMessage>}
      {update.isSuccess && <ProfileMessage>Display name updated.</ProfileMessage>}
      <button className="profile-primary-action" disabled={update.isPending} type="submit">
        {update.isPending ? "Saving…" : "Save name"}
      </button>
    </form>
  );
}

function PasswordForm({ token }: { token: string }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const changePassword = useMutation({
    mutationFn: async () => {
      const parsed = ChangePasswordRequestSchema.safeParse({ currentPassword, newPassword });
      if (!parsed.success) throw new Error(parsed.error.issues.map((issue) => issue.message).join("; "));
      await apiRequest("/api/v1/users/me/password", z.void(), token, {
        method: "PATCH",
        body: JSON.stringify(parsed.data)
      });
    },
    onSuccess: () => {
      setCurrentPassword("");
      setNewPassword("");
      setConfirmation("");
      setError(null);
      setSuccess(true);
    },
    onError: (changeError: Error) => {
      setError(changeError.message);
      setSuccess(false);
    }
  });

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (newPassword !== confirmation) {
      setError("New password and confirmation do not match.");
      setSuccess(false);
      return;
    }
    const parsed = ChangePasswordRequestSchema.safeParse({ currentPassword, newPassword });
    if (!parsed.success) {
      setError(parsed.error.issues.map((issue) => issue.message).join("; "));
      setSuccess(false);
      return;
    }
    setError(null);
    changePassword.mutate();
  }

  return (
    <form className="profile-form profile-password-form" onSubmit={submit}>
      <label><span>Current password</span>
        <input autoComplete="current-password" onChange={(event) => setCurrentPassword(event.target.value)} type="password" value={currentPassword} />
      </label>
      <label><span>New password</span>
        <input autoComplete="new-password" onChange={(event) => setNewPassword(event.target.value)} type="password" value={newPassword} />
      </label>
      <label><span>Confirm new password</span>
        <input autoComplete="new-password" onChange={(event) => setConfirmation(event.target.value)} type="password" value={confirmation} />
      </label>
      {error !== null && <ProfileMessage error>{error}</ProfileMessage>}
      {success && <ProfileMessage>Password changed successfully.</ProfileMessage>}
      <button className="profile-primary-action" disabled={changePassword.isPending} type="submit">
        {changePassword.isPending ? "Changing password…" : "Change password"}
      </button>
    </form>
  );
}

function ResetCooldownAdmin({ token }: { token: string }) {
  const queryClient = useQueryClient();
  const setting = useQuery({
    queryKey: ["admin", "virtual-reset-cooldown"],
    queryFn: () => apiRequest("/api/admin/settings/virtual-account-reset-cooldown", VirtualResetCooldownResponseSchema, token)
  });
  const [hours, setHours] = useState("");
  const update = useMutation({
    mutationFn: () => {
      const parsed = VirtualResetCooldownSchema.safeParse({ cooldownHours: Number(hours) });
      if (!parsed.success) throw new Error(parsed.error.issues.map((issue) => issue.message).join("; "));
      return apiRequest(
        "/api/admin/settings/virtual-account-reset-cooldown",
        VirtualResetCooldownResponseSchema,
        token,
        { method: "PUT", body: JSON.stringify(parsed.data) }
      );
    },
    onSuccess: async (result) => {
      setHours(String(result.cooldownHours));
      await queryClient.invalidateQueries({ queryKey: ["profile-details"] });
    }
  });

  if (setting.isPending) return <ProfileMessage>Loading reset cooldown configuration…</ProfileMessage>;
  if (setting.error instanceof Error) return <ProfileMessage error>Reset cooldown setting could not be loaded: {setting.error.message}</ProfileMessage>;
  if (setting.data === undefined) return <ProfileMessage error>Reset cooldown setting is unavailable.</ProfileMessage>;

  const currentHours = hours === "" ? setting.data.cooldownHours : Number(hours);
  return (
    <form className="profile-admin-cooldown" onSubmit={(event) => { event.preventDefault(); update.mutate(); }}>
      <label><span>Reset cooldown (hours)</span>
        <input max="8760" min="1" onChange={(event) => setHours(event.target.value)} type="number" value={String(currentHours)} />
      </label>
      <button className="profile-secondary-action" disabled={update.isPending} type="submit">{update.isPending ? "Saving…" : "Update cooldown"}</button>
      {update.error instanceof Error && <ProfileMessage error>{update.error.message}</ProfileMessage>}
      {update.isSuccess && <ProfileMessage>Reset cooldown updated for all accounts.</ProfileMessage>}
    </form>
  );
}

export function ProfilePage() {
  const { token, user, avatarUrl, uploadAvatar, updateUser } = useAuth();
  const queryClient = useQueryClient();
  const [resetConfirm, setResetConfirm] = useState("");
  const profile = useQuery({
    queryKey: ["profile-details"],
    queryFn: () => apiRequest("/api/v1/users/me", ProfileDetailsResponseSchema, token ?? undefined),
    enabled: token !== null
  });
  const reset = useMutation({
    mutationFn: () => {
      const input = ResetVirtualAccountRequestSchema.parse({ confirm: "RESET" });
      return apiRequest("/api/v1/users/me/reset", ResetVirtualAccountResponseSchema, token ?? undefined, {
        method: "POST",
        body: JSON.stringify(input)
      });
    },
    onSuccess: async () => {
      setResetConfirm("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["profile-details"] }),
        queryClient.invalidateQueries({ queryKey: ["portfolio"] }),
        queryClient.invalidateQueries({ queryKey: ["orders"] }),
        queryClient.invalidateQueries({ queryKey: ["risk"] })
      ]);
    }
  });
  const isCooldownActive = profile.data?.nextResetAt !== null &&
    profile.data?.nextResetAt !== undefined &&
    Date.parse(profile.data.nextResetAt) > Date.now();

  function requestReset(): void {
    if (resetConfirm !== "RESET") return;
    if (window.confirm("Reset this virtual trading account? Open orders will be cancelled, positions cleared, and cash restored. Historical trades and ledger entries will remain.")) {
      reset.mutate();
    }
  }

  return (
    <div className="profile-workspace">
      <header className="profile-page-heading">
        <p className="workspace-eyebrow">Account settings</p>
        <h2>Profile</h2>
        <p>Manage your personal information and virtual trading account.</p>
      </header>

      <section aria-labelledby="profile-info-heading" className="workspace-panel profile-panel">
        <div className="profile-section-heading"><div><p className="workspace-eyebrow">Personal details</p><h3 id="profile-info-heading">Profile information</h3></div></div>
        {token === null || user === null ? <ProfileMessage error>Your session is unavailable. Sign in again.</ProfileMessage> : (
          <>
            <AvatarEditor avatarUrl={avatarUrl} displayName={user.displayName} uploadAvatar={uploadAvatar} />
            <DisplayNameForm token={token} user={user} onUpdated={updateUser} />
            {profile.isPending ? <ProfileMessage>Loading account information…</ProfileMessage> :
              profile.error instanceof Error ? <ProfileMessage error>Account information could not be loaded: {profile.error.message}</ProfileMessage> :
                profile.data !== undefined && (
                  <dl className="profile-account-info">
                    <div><dt>Email</dt><dd>{profile.data.user.email}</dd></div>
                    <div><dt>Role</dt><dd className="capitalize">{profile.data.user.role}</dd></div>
                    <div><dt>Member since</dt><dd><time dateTime={profile.data.createdAt}>{new Date(profile.data.createdAt).toLocaleDateString()}</time></dd></div>
                  </dl>
                )}
          </>
        )}
      </section>

      <section aria-labelledby="profile-password-heading" className="workspace-panel profile-panel">
        <div className="profile-section-heading"><div><p className="workspace-eyebrow">Security</p><h3 id="profile-password-heading">Change password</h3></div></div>
        {token === null ? <ProfileMessage error>Sign in to change your password.</ProfileMessage> : <PasswordForm token={token} />}
      </section>

      {user?.role === "admin" && token !== null && (
        <section aria-labelledby="profile-admin-reset-heading" className="workspace-panel profile-panel">
          <div className="profile-section-heading"><div><p className="workspace-eyebrow">Administrator control</p><h3 id="profile-admin-reset-heading">Virtual account reset cooldown</h3></div></div>
          <p className="profile-helper">Set the minimum wait between resets for every account. The initial default is 24 hours.</p>
          <ResetCooldownAdmin token={token} />
        </section>
      )}

      <section aria-labelledby="profile-reset-heading" className="workspace-panel profile-panel profile-reset-panel">
        <div className="profile-section-heading"><div><p className="workspace-eyebrow">Virtual money only</p><h3 id="profile-reset-heading">Reset virtual account</h3></div></div>
        <p className="profile-helper">Cancel open orders, clear current positions, and restore the starting virtual cash balance. Your historical orders, fills, and ledger remain available.</p>
        {profile.isPending ? <ProfileMessage>Checking reset eligibility…</ProfileMessage> :
          profile.error instanceof Error ? <ProfileMessage error>Reset eligibility could not be loaded: {profile.error.message}</ProfileMessage> :
            profile.data !== undefined && (
              <div className="profile-reset-status">
                <span>{isCooldownActive ? `Available after ${new Date(profile.data.nextResetAt!).toLocaleString()}` : `Reset available · ${profile.data.resetCooldownHours}-hour cooldown`}</span>
                <label><span>Type RESET to confirm</span>
                  <input autoComplete="off" onChange={(event) => setResetConfirm(event.target.value)} value={resetConfirm} />
                </label>
                <button
                  className="profile-danger-action"
                  disabled={reset.isPending || isCooldownActive || resetConfirm !== "RESET" || token === null}
                  onClick={requestReset}
                  type="button"
                >{reset.isPending ? "Resetting account…" : "Reset virtual account"}</button>
              </div>
            )}
        {reset.error instanceof Error && <ProfileMessage error>Account reset failed: {reset.error.message}</ProfileMessage>}
        {reset.data !== undefined && <ProfileMessage>Virtual account reset. {reset.data.cancelledOrders} open orders cancelled, {reset.data.clearedPositions} positions cleared, and starting cash restored. Next reset: {new Date(reset.data.nextResetAt).toLocaleString()}.</ProfileMessage>}
      </section>
    </div>
  );
}
