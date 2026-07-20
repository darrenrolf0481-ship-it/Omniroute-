const k = '\\';
const escaped = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
console.log('escaped:', escaped);
const regex = new RegExp(`(${escaped})`, 'gi');
console.log('regex:', regex);
