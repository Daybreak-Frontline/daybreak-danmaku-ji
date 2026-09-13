export function hasPermission(user, perm = {}, superUsers = []) {
  if (superUsers && superUsers.includes(user.name)) return true;
  if (perm.allowManager && user.isManager) return true;
  if (perm.minGuardType > 0) return user.guardType > 0 && user.guardType <= perm.minGuardType;
  if (perm.minMedalLevel > 0 && user.medalLevel >= perm.minMedalLevel) {
    if (!perm.medalName || user.medalName === perm.medalName) return true;
  } else if ((perm.minMedalLevel || 0) === 0 && !(perm.minGuardType > 0)) {
    return true;
  }
  return false;
}

export const DEFAULT_COMMAND_CONFIG = {
  superUsers: [],
  userCooldownSec: 30,
  globalCooldownSec: 5,
  playlistLimit: 30,
  command: ['点歌'],
  orderPerm: { allowManager: true, minGuardType: 0, minMedalLevel: 0, medalName: '' },
  skipPerm: { allowManager: true, minGuardType: 0, minMedalLevel: 1, medalName: '' },
  topPerm: { allowManager: true, minGuardType: 3, minMedalLevel: 0, medalName: '' },
  forcePerm: { allowManager: true, minGuardType: -1, minMedalLevel: 0, medalName: '' },
  togglePerm: { allowManager: true, minGuardType: 0, minMedalLevel: 0, medalName: '' }
};
