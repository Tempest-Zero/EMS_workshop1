import { useState, useEffect } from "react";
import { Modal } from "@shared/ui/Overlay";
import { Button, Field, inputClass } from "@shared/ui/primitives";
import { useApp } from "@app/providers/AppContext";

export function UserFormModal({ open, onClose, user, onSubmit }) {
  const [formData, setFormData] = useState({
    id: "",
    username: "",
    name: "",
    password: "",
    role: "tech",
    phone: "",
    specialty: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const { addToast } = useApp();

  useEffect(() => {
    if (user) {
      setFormData({
        id: user.id,
        username: user.username,
        name: user.name,
        password: "", 
        role: user.role,
        phone: user.phone || "",
        specialty: user.specialty || "",
      });
    } else {
      setFormData({
        id: "",
        username: "",
        name: "",
        password: "",
        role: "tech",
        phone: "",
        specialty: "",
      });
    }
  }, [user, open]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      await onSubmit(formData);
      onClose();
    } catch (err) {
      addToast(err.message || "Failed to save user", "danger");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={user ? "Edit User" : "Create New User"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button variant="primary" onClick={handleSubmit} disabled={submitting}>
            {submitting ? "Saving..." : "Save"}
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} id="user-form" className="space-y-4">
        {!user && (
          <div className="grid grid-cols-2 gap-4">
            <Field label="ID" hint="Unique ID (e.g., t2)">
              <input
                className={inputClass}
                required
                value={formData.id}
                onChange={(e) => setFormData({ ...formData, id: e.target.value })}
              />
            </Field>
            <Field label="Username">
              <input
                className={inputClass}
                required
                value={formData.username}
                onChange={(e) => setFormData({ ...formData, username: e.target.value })}
              />
            </Field>
          </div>
        )}
        <Field label="Full Name">
          <input
            className={inputClass}
            required
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          />
        </Field>
        {!user && (
          <Field label="Initial Password" hint="Minimum 8 chars (upper, lower, num, special)">
            <input
              type="password"
              className={inputClass}
              required
              minLength={8}
              value={formData.password}
              onChange={(e) => setFormData({ ...formData, password: e.target.value })}
            />
          </Field>
        )}
        <div className="grid grid-cols-2 gap-4">
          <Field label="Role">
            <select
              className={inputClass}
              value={formData.role}
              onChange={(e) => setFormData({ ...formData, role: e.target.value })}
            >
              <option value="tech">Technician</option>
              <option value="manager">Manager</option>
            </select>
          </Field>
          <Field label="Phone">
            <input
              type="tel"
              className={inputClass}
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
            />
          </Field>
        </div>
        <Field label="Specialty">
          <input
            className={inputClass}
            value={formData.specialty}
            onChange={(e) => setFormData({ ...formData, specialty: e.target.value })}
          />
        </Field>
      </form>
    </Modal>
  );
}
