// Look of each announcement `type` (set in CMS → Community → Announcements).
const STYLES = {
  info:    { label: "Notice",    icon: "information-circle", color: "#1B4D5C", bg: "#E3EEF1", border: "#C5DCE2", chip: "#1B4D5C" },
  success: { label: "Good news", icon: "checkmark-circle",   color: "#14753F", bg: "#E4F5EA", border: "#BFE5CC", chip: "#1E9E55" },
  warning: { label: "Warning",   icon: "warning",            color: "#92400E", bg: "#FFF4DC", border: "#F6DFA6", chip: "#F59E0B" },
  urgent:  { label: "Urgent",    icon: "alert-circle",       color: "#991B1B", bg: "#FDE8E8", border: "#F5C2C2", chip: "#DC3B3B" },
}
export const announcementStyle = (type) => STYLES[type] || STYLES.info
