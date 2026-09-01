// 가로챈 응답(JSON)에서 노트 정보를 뽑아냅니다.
// 샤오홍슈가 응답 모양을 camelCase / snake_case 로 섞어 쓰기 때문에
// 정해진 경로를 따라가지 않고 양쪽 이름을 모두 살펴봅니다.
"use strict";

var VIDEO_URL_RE = /^https?:\/\/[^\s"]*sns-video[^\s"]*\.(?:mp4|m3u8)/i;
var NOTE_ID_RE = /([0-9a-f]{24})/i;

function pick(obj, names) {
  for (var i = 0; i < names.length; i++) {
    var value = obj[names[i]];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

function walk(node, visit, depth) {
  depth = depth || 0;
  if (!node || typeof node !== "object" || depth > 30) return;
  visit(node);
  if (Array.isArray(node)) {
    for (var i = 0; i < node.length; i++) walk(node[i], visit, depth + 1);
    return;
  }
  for (var key in node) {
    if (Object.prototype.hasOwnProperty.call(node, key)) {
      walk(node[key], visit, depth + 1);
    }
  }
}

function collectVideoUrls(video) {
  var urls = [];
  walk(video, function (node) {
    if (Array.isArray(node)) return;
    for (var key in node) {
      if (!Object.prototype.hasOwnProperty.call(node, key)) continue;
      var value = node[key];
      var lowered = key.toLowerCase();
      if (typeof value === "string") {
        if (lowered === "masterurl" || lowered === "master_url" || VIDEO_URL_RE.test(value)) {
          urls.push(value);
        }
      } else if (Array.isArray(value) && (lowered === "backupurls" || lowered === "backup_urls")) {
        for (var i = 0; i < value.length; i++) {
          if (typeof value[i] === "string") urls.push(value[i]);
        }
      }
    }
  });
  // https 우선, mp4 우선.
  urls.sort(function (a, b) {
    var score = function (url) {
      return (url.indexOf("https:") === 0 ? 2 : 0) + (url.indexOf(".mp4") !== -1 ? 1 : 0);
    };
    return score(b) - score(a);
  });
  return urls;
}

function pickImageUrls(list) {
  var urls = [];
  if (!Array.isArray(list)) return urls;
  for (var i = 0; i < list.length; i++) {
    var item = list[i];
    if (!item || typeof item !== "object") continue;
    var chosen = "";
    var infoList = pick(item, ["infoList", "info_list"]);
    if (Array.isArray(infoList)) {
      for (var j = 0; j < infoList.length; j++) {
        var info = infoList[j];
        if (!info || typeof info !== "object") continue;
        var scene = pick(info, ["imageScene", "image_scene"]);
        if (scene === "WB_DFT" && typeof info.url === "string") {
          chosen = info.url;
          break;
        }
      }
    }
    if (!chosen) {
      var fallback = pick(item, ["urlDefault", "url_default", "urlPre", "url_pre", "url"]);
      if (typeof fallback === "string") chosen = fallback;
    }
    if (chosen) urls.push(chosen.indexOf("!") === -1 ? chosen.split("?")[0] : chosen);
  }
  return urls;
}

function looksLikeNote(node) {
  if (!node || typeof node !== "object" || Array.isArray(node)) return false;
  var hasMedia =
    node.video !== undefined ||
    node.imageList !== undefined ||
    node.image_list !== undefined;
  var hasMeta =
    node.title !== undefined || node.desc !== undefined || node.user !== undefined;
  return hasMedia && hasMeta;
}

function noteFrom(node, fallbackId) {
  var user = node.user && typeof node.user === "object" ? node.user : {};
  var videos = collectVideoUrls(node.video);
  var images = pickImageUrls(pick(node, ["imageList", "image_list"]));
  var id = pick(node, ["noteId", "note_id", "id"]) || fallbackId || "";
  return {
    noteId: typeof id === "string" ? id : "",
    title: String(pick(node, ["title"]) || "").trim(),
    desc: String(pick(node, ["desc"]) || "").trim(),
    author: String(pick(user, ["nickname", "nick_name", "name"]) || "").trim(),
    videoUrl: videos.length > 0 ? videos[0] : "",
    imageUrls: images,
  };
}

/**
 * 응답 본문에서 노트들을 찾아냅니다. targetId 가 있으면 그 노트를 우선합니다.
 * 미디어 주소가 없는 껍데기 노트는 버립니다.
 */
function extractNotes(text, targetId) {
  var root;
  try {
    root = JSON.parse(text);
  } catch (error) {
    return [];
  }

  var found = [];
  walk(root, function (node) {
    if (!looksLikeNote(node)) return;
    // 여기서는 노트 번호를 추측하지 않습니다. 번호는 아래 열쇠 탐색에서
    // 채웁니다. 섞여 온 노트 전부에 같은 번호를 붙이면 안 되기 때문입니다.
    var note = noteFrom(node, "");
    if (!note.videoUrl && note.imageUrls.length === 0) return;
    found.push(note);
  });

  // noteDetailMap 처럼 노트 번호를 열쇠로 쓰는 구조는 번호를 되살립니다.
  walk(root, function (node) {
    if (Array.isArray(node)) return;
    for (var key in node) {
      if (!Object.prototype.hasOwnProperty.call(node, key)) continue;
      if (!NOTE_ID_RE.test(key)) continue;
      var entry = node[key];
      if (!entry || typeof entry !== "object") continue;
      var inner = entry.note && typeof entry.note === "object" ? entry.note : entry;
      if (!looksLikeNote(inner)) continue;
      var note = noteFrom(inner, key);
      if (!note.noteId) note.noteId = key;
      if (!note.videoUrl && note.imageUrls.length === 0) continue;
      found.push(note);
    }
  });

  // 같은 노트를 두 경로에서 찾는 일이 흔합니다. 하나로 합치되,
  // 노트 번호를 알고 있는 쪽을 남깁니다.
  var unique = [];
  var indexBySignature = {};
  for (var i = 0; i < found.length; i++) {
    var signature = found[i].videoUrl || found[i].imageUrls.join("|");
    var seenAt = indexBySignature[signature];
    if (seenAt === undefined) {
      indexBySignature[signature] = unique.length;
      unique.push(found[i]);
    } else if (!unique[seenAt].noteId && found[i].noteId) {
      unique[seenAt].noteId = found[i].noteId;
    }
  }

  // 노트가 하나뿐이면 그게 찾던 노트입니다.
  if (unique.length === 1 && !unique[0].noteId) unique[0].noteId = targetId || "";

  if (targetId) {
    unique.sort(function (a, b) {
      return (b.noteId === targetId ? 1 : 0) - (a.noteId === targetId ? 1 : 0);
    });
  }
  return unique;
}

if (typeof module !== "undefined") module.exports = { extractNotes: extractNotes };
