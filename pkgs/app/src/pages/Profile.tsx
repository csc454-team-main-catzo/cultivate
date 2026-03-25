import { useUser } from "../providers/userContext";
import { useApi } from "../providers/apiContext";
import { AccountSettings } from "../components/ui/account-settings";

export default function Profile() {
  const { user, refreshUser } = useUser();
  const { users } = useApi();

  const handleNameSave = async (name: string) => {
    try {
      await users.updateCurrentUser({ updateUserRequest: { name } });
      await refreshUser();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to save name";
      alert(msg);
      throw err;
    }
  };

  const handleEmailSave = async (email: string) => {
    try {
      await users.updateCurrentUser({ updateUserRequest: { email } });
      await refreshUser();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to save email";
      alert(msg);
      throw err;
    }
  };

  const handleAvatarSave = async (avatarDataUrl: string) => {
    try {
      await users.updateCurrentUser({
        updateUserRequest: { avatar: avatarDataUrl },
      });
      await refreshUser();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to save avatar";
      alert(msg);
      throw err;
    }
  };

  const handlePostalSave = async (postalCode: string) => {
    try {
      await users.updateCurrentUser({
        updateUserRequest: { postalCode },
      });
      await refreshUser();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to save postal code";
      alert(msg);
      throw err;
    }
  };

  if (!user) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-8">
        <p className="text-zinc-500">Loading...</p>
      </div>
    );
  }

  return (
    <AccountSettings
      name={user.name ?? "User"}
      email={user.email ?? ""}
      avatar={user.avatar ?? undefined}
      postalCode={user.postalCode ?? null}
      onNameSave={handleNameSave}
      onEmailSave={handleEmailSave}
      onAvatarSave={handleAvatarSave}
      onPostalSave={handlePostalSave}
    />
  );
}
