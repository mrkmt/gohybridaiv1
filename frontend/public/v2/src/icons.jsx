// Minimal inline SVG icons (lucide-style, stroke 1.5)
const I = (p, extra) => ({ size = 16, ...rest }) =>
  React.createElement('svg', {
    width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
    stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round',
    ...rest
  }, ...p);

const IconPlus = I([<line x1="12" y1="5" x2="12" y2="19" key="1"/>, <line x1="5" y1="12" x2="19" y2="12" key="2"/>]);
const IconSearch = I([<circle cx="11" cy="11" r="7" key="1"/>, <path d="m20 20-3.5-3.5" key="2"/>]);
const IconSend = I([<path d="M22 2 11 13" key="1"/>, <path d="M22 2 15 22l-4-9-9-4 20-7z" key="2"/>]);
const IconMessage = I([<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" key="1"/>]);
const IconActivity = I([<path d="M22 12h-4l-3 9L9 3l-3 9H2" key="1"/>]);
const IconFlask = I([<path d="M9 3h6v2l4 11a3 3 0 0 1-3 4H8a3 3 0 0 1-3-4L9 5V3z" key="1"/>, <path d="M7 13h10" key="2"/>]);
const IconSettings = I([<circle cx="12" cy="12" r="3" key="1"/>, <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" key="2"/>]);
const IconLogout = I([<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" key="1"/>, <polyline points="16 17 21 12 16 7" key="2"/>, <line x1="21" y1="12" x2="9" y2="12" key="3"/>]);
const IconTrash = I([<polyline points="3 6 5 6 21 6" key="1"/>, <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" key="2"/>]);
const IconCheck = I([<polyline points="20 6 9 17 4 12" key="1"/>]);
const IconX = I([<line x1="18" y1="6" x2="6" y2="18" key="1"/>, <line x1="6" y1="6" x2="18" y2="18" key="2"/>]);
const IconChevronRight = I([<polyline points="9 18 15 12 9 6" key="1"/>]);
const IconChevronDown = I([<polyline points="6 9 12 15 18 9" key="1"/>]);
const IconPlay = I([<polygon points="5 3 19 12 5 21 5 3" key="1"/>]);
const IconRefresh = I([<polyline points="23 4 23 10 17 10" key="1"/>, <polyline points="1 20 1 14 7 14" key="2"/>, <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10" key="3"/>, <path d="M20.49 15a9 9 0 0 1-14.85 3.36L1 14" key="4"/>]);
const IconLock = I([<rect x="3" y="11" width="18" height="11" rx="2" key="1"/>, <path d="M7 11V7a5 5 0 0 1 10 0v4" key="2"/>]);
const IconMail = I([<rect x="2" y="4" width="20" height="16" rx="2" key="1"/>, <polyline points="22 6 12 13 2 6" key="2"/>]);
const IconSparkles = I([<path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" key="1"/>]);
const IconFile = I([<path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" key="1"/>, <polyline points="13 2 13 9 20 9" key="2"/>]);
const IconTerminal = I([<polyline points="4 17 10 11 4 5" key="1"/>, <line x1="12" y1="19" x2="20" y2="19" key="2"/>]);
const IconUser = I([<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" key="1"/>, <circle cx="12" cy="7" r="4" key="2"/>]);
const IconAlert = I([<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" key="1"/>, <path d="M12 9v4" key="2"/>, <path d="M12 17h.01" key="3"/>]);
const IconCommand = I([<path d="M18 3a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3 3 3 0 0 0 3-3 3 3 0 0 0-3-3H6a3 3 0 0 0-3 3 3 3 0 0 0 3 3 3 3 0 0 0 3-3V6a3 3 0 0 0-3-3 3 3 0 0 0-3 3 3 3 0 0 0 3 3h12a3 3 0 0 0 3-3 3 3 0 0 0-3-3z" key="1"/>]);
const IconDatabase = I([<ellipse cx="12" cy="5" rx="9" ry="3" key="1"/>, <path d="M3 5v14a9 3 0 0 0 18 0V5" key="2"/>, <path d="M3 12a9 3 0 0 0 18 0" key="3"/>]);
const IconGitBranch = I([<line x1="6" y1="3" x2="6" y2="15" key="1"/>, <circle cx="18" cy="6" r="3" key="2"/>, <circle cx="6" cy="18" r="3" key="3"/>, <path d="M18 9a9 9 0 0 1-9 9" key="4"/>]);
const IconZap = I([<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" key="1"/>]);
const IconSliders = I([<line x1="4" y1="21" x2="4" y2="14" key="1"/>, <line x1="4" y1="10" x2="4" y2="3" key="2"/>, <line x1="12" y1="21" x2="12" y2="12" key="3"/>, <line x1="12" y1="8" x2="12" y2="3" key="4"/>, <line x1="20" y1="21" x2="20" y2="16" key="5"/>, <line x1="20" y1="12" x2="20" y2="3" key="6"/>, <line x1="1" y1="14" x2="7" y2="14" key="7"/>, <line x1="9" y1="8" x2="15" y2="8" key="8"/>, <line x1="17" y1="16" x2="23" y2="16" key="9"/>]);

Object.assign(window, {
  IconPlus, IconSearch, IconSend, IconMessage, IconActivity, IconFlask, IconSettings,
  IconLogout, IconTrash, IconCheck, IconX, IconChevronRight, IconChevronDown, IconPlay,
  IconRefresh, IconLock, IconMail, IconSparkles, IconFile, IconTerminal, IconUser, IconAlert,
  IconCommand, IconDatabase, IconGitBranch, IconZap, IconSliders
});
