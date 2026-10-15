// Shows the active room code on the toolbar badge; nothing else runs here.
const refresh = async () => {
  const { cvRoom } = await chrome.storage.local.get('cvRoom');
  await chrome.action.setBadgeText({ text: cvRoom ? cvRoom.roomCode || 'ON' : '' });
  await chrome.action.setBadgeBackgroundColor({ color: '#8b5cf6' });
  await chrome.action.setTitle({ title: cvRoom ? `CouchVerse: in room ${cvRoom.roomCode} (${cvRoom.roomName || ''})` : 'CouchVerse Companion: open a room on the CouchVerse site' });
};
chrome.runtime.onInstalled.addListener(refresh);
chrome.runtime.onStartup.addListener(refresh);
chrome.storage.onChanged.addListener((c) => c.cvRoom && refresh());
chrome.action.onClicked.addListener(async () => {
  // Clicking the icon leaves the room.
  await chrome.storage.local.remove('cvRoom');
});
