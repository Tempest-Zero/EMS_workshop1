import { useEffect, useState } from "react";
import { SectionHeader, Button, Card } from "@shared/ui/primitives";
import { Plus, Edit2, ShieldAlert } from "lucide-react";
import Avatar from "@shared/ui/Avatar";
import { useApp } from "@app/providers/AppContext";
import { fetchAllUsers, createUser, updateUser } from "../data/usersApi";
import { UserFormModal } from "../components/UserFormModal";

export function Users() {
  const [users, setUsers] = useState([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const { addToast } = useApp();

  const loadUsers = async () => {
    try {
      const data = await fetchAllUsers();
      setUsers(data);
    } catch {
      addToast("Failed to load users", "danger");
    }
  };

  useEffect(() => {
    loadUsers();
  }, []);

  const handleOpenCreate = () => {
    setEditingUser(null);
    setModalOpen(true);
  };

  const handleOpenEdit = (user) => {
    setEditingUser(user);
    setModalOpen(true);
  };

  const handleSubmit = async (formData) => {
    if (editingUser) {
      await updateUser(editingUser.id, {
        name: formData.name,
        role: formData.role,
        phone: formData.phone || null,
        specialty: formData.specialty || null,
      });
      addToast("User updated successfully", "success");
    } else {
      await createUser({
        id: formData.id,
        username: formData.username,
        password: formData.password,
        name: formData.name,
        role: formData.role,
        phone: formData.phone || null,
        specialty: formData.specialty || null,
      });
      addToast("User created successfully. They must change their password on first login.", "success");
    }
    loadUsers();
  };

  const toggleStatus = async (user) => {
    try {
      await updateUser(user.id, { active: !user.active });
      addToast(`User ${user.active ? "deactivated" : "activated"}`, "success");
      loadUsers();
    } catch {
      addToast("Failed to change user status", "danger");
    }
  };

  return (
    <div className="space-y-6">
      <SectionHeader
        title="User Management"
        sub="Manage technicians and managers, their roles, and system access."
        action={
          <Button variant="primary" onClick={handleOpenCreate}>
            <Plus className="h-4 w-4" /> Add User
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-4">
        {users.map((user) => (
          <Card key={user.id} className={`p-4 ${!user.active ? "opacity-75 bg-slate-50" : ""}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <Avatar name={user.name} color={user.avatar} size="lg" />
                <div>
                  <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                    {user.name}
                    {user.must_change_password && (
                      <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800" title="Must change password on next login">
                        <ShieldAlert className="h-3 w-3" />
                        Pending Setup
                      </span>
                    )}
                  </h3>
                  <div className="flex gap-3 mt-1 text-sm text-slate-500">
                    <span>@{user.username}</span>
                    <span>•</span>
                    <span className="capitalize">{user.role}</span>
                    <span>•</span>
                    <span>{user.active ? "Active" : "Inactive"}</span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Button variant="ghost" size="sm" onClick={() => handleOpenEdit(user)}>
                  <Edit2 className="h-4 w-4" /> Edit
                </Button>
                <Button 
                  variant={user.active ? "outlineDanger" : "secondary"} 
                  size="sm" 
                  onClick={() => toggleStatus(user)}
                >
                  {user.active ? "Deactivate" : "Activate"}
                </Button>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <UserFormModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        user={editingUser}
        onSubmit={handleSubmit}
      />
    </div>
  );
}
