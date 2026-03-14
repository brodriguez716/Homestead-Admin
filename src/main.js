import "./style.css";

import { initializeApp } from "firebase/app";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";

import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  collection,
  query,
  where,
  getDocs,
  serverTimestamp,
} from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyAjXNZ4XnyRPq56VWGDlacmVFSgTAik4Tg",
  authDomain: "homestead-cm.firebaseapp.com",
  projectId: "homestead-cm",
  storageBucket: "homestead-cm.appspot.com",
  messagingSenderId: "169140909942",
  appId: "1:169140909942:web:f6c628bd597e9eb53cec57",
  measurementId: "G-1FQP782SZM",
};

initializeApp(firebaseConfig);

const auth = getAuth();
const db = getFirestore();
const appEl = document.querySelector("#app");

function renderLogin(errorMsg = "") {
  appEl.innerHTML = `
    <div class="page">
      <div class="card">
        <h1>Homestead Admin</h1>
        <p class="muted">Sign in to manage community website content.</p>

        ${errorMsg ? `<div class="error">${errorMsg}</div>` : ""}

        <form id="loginForm" class="form">
          <label>
            Email
            <input id="email" type="email" placeholder="you@homesteadrm.com" required />
          </label>

          <label>
            Password
            <input id="password" type="password" placeholder="********" required />
          </label>

          <button type="submit">Sign In</button>
        </form>

        <p class="muted small">
          Tip: Create users in Firebase Console -> Authentication -> Users.
        </p>
      </div>
    </div>
  `;

  document.getElementById("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;

    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (err) {
      renderLogin(err?.message || "Login failed.");
    }
  });
}

async function getUserProfile(uid) {
  const snap = await getDoc(doc(db, "users", uid));
  if (!snap.exists()) throw new Error("No user profile found. Create Firestore doc users/{uid}.");
  return snap.data();
}

async function getCommunitiesByIds(ids) {
  if (!ids?.length) return [];
  const q = query(collection(db, "communities"), where("__name__", "in", ids));
  const snaps = await getDocs(q);
  return snaps.docs.map((d) => ({ id: d.id, ...d.data() }));
}

function communitySelectorHtml(communities, selectedId) {
  const options = communities
    .map((c) => `<option value="${c.id}" ${c.id === selectedId ? "selected" : ""}>${c.name}</option>`)
    .join("");

  return `
    <label>
      Select community
      <select id="communitySelect">
        <option value="">-- Choose --</option>
        ${options}
      </select>
    </label>
  `;
}

async function renderDashboard(user) {
  const profile = await getUserProfile(user.uid);
  const communities = await getCommunitiesByIds(profile.communityIds || []);

  const last = localStorage.getItem("selectedCommunityId");
  const defaultId =
    last && communities.find((c) => c.id === last) ? last : (communities[0]?.id || "");

  appEl.innerHTML = `
    <div class="page">
      <div class="card">
        <div class="row">
          <div>
            <h1>Homestead Admin</h1>
            <p class="muted">Signed in as <b>${user.email}</b></p>
          </div>
          <button id="logoutBtn" class="secondary">Log out</button>
        </div>

        ${communitySelectorHtml(communities, defaultId)}

        <div id="communityArea"></div>
      </div>
    </div>
  `;

  document.getElementById("logoutBtn").addEventListener("click", async () => {
    await signOut(auth);
  });

  const select = document.getElementById("communitySelect");
  select.addEventListener("change", () => {
    localStorage.setItem("selectedCommunityId", select.value);
    renderCommunityArea(select.value, communities);
  });

  renderCommunityArea(defaultId, communities);
}

function renderCommunityArea(communityId, communities) {
  const area = document.getElementById("communityArea");
  const c = communities.find((x) => x.id === communityId);

  if (!communityId || !c) {
    area.innerHTML = `<p class="muted">Choose a community to start editing.</p>`;
    return;
  }

  area.innerHTML = `
    <h2>${c.name}</h2>
    <p class="muted">Site: <a href="${c.siteUrl}" target="_blank" rel="noreferrer">${c.siteUrl}</a></p>

    <div class="grid">
      <button class="tile" id="btnHomepage">Homepage</button>
      <button class="tile" disabled>Governing Docs</button>
      <button class="tile" disabled>Newsletters</button>
      <button class="tile" disabled>FAQs</button>
      <button class="tile" disabled>Contact Management</button>
    </div>

    <div id="editorArea" style="margin-top:16px;"></div>
  `;

  document.getElementById("btnHomepage").addEventListener("click", () => {
    renderHomepageEditor(communityId, c);
  });
}

function emptyHomepageDraft() {
  return {
    keyDates: [
      { title: "Board Meeting", date: "2026-03-15", body: "7pm - Clubhouse", linkUrl: "" },
    ],
    communityManagerContacts: [
      { title: "Community Manager", name: "Robin", email: "robin@homesteadrm.com", phone: "" },
    ],
    boardMembers: [
      { title: "Board President", name: "", email: "", phone: "" },
    ],
    updatedAt: null,
  };
}

function normalizeContact(item = {}) {
  return {
    title: item.title || "",
    name: item.name || "",
    email: item.email || "",
    phone: item.phone || "",
  };
}

function splitBoardAndManagement(items = []) {
  const communityManagerContacts = [];
  const boardMembers = [];

  items.forEach((item) => {
    const normalized = normalizeContact(item);
    const role = `${normalized.title} ${normalized.name}`.toLowerCase();
    const isManagement =
      role.includes("manager") ||
      role.includes("management") ||
      role.includes("community contact");

    if (isManagement) {
      communityManagerContacts.push(normalized);
    } else {
      boardMembers.push(normalized);
    }
  });

  return { communityManagerContacts, boardMembers };
}

async function loadHomepageDraft(communityId) {
  const ref = doc(db, "communities", communityId, "draft", "homepage");
  const snap = await getDoc(ref);
  if (!snap.exists()) return emptyHomepageDraft();

  const data = snap.data();
  const legacySplit = splitBoardAndManagement(
    Array.isArray(data.boardAndManagement) ? data.boardAndManagement : []
  );

  return {
    keyDates: Array.isArray(data.keyDates) ? data.keyDates : [],
    communityManagerContacts: Array.isArray(data.communityManagerContacts)
      ? data.communityManagerContacts.map(normalizeContact)
      : legacySplit.communityManagerContacts,
    boardMembers: Array.isArray(data.boardMembers)
      ? data.boardMembers.map(normalizeContact)
      : legacySplit.boardMembers,
  };
}

async function saveHomepageDraft(communityId, draft) {
  const ref = doc(db, "communities", communityId, "draft", "homepage");
  await setDoc(ref, { ...draft, updatedAt: serverTimestamp() }, { merge: true });
}

async function publishHomepage(communityId) {
  const draftRef = doc(db, "communities", communityId, "draft", "homepage");
  const pubRef = doc(db, "communities", communityId, "published", "homepage");

  const snap = await getDoc(draftRef);
  if (!snap.exists()) throw new Error("No draft homepage to publish yet.");

  const data = snap.data();
  await setDoc(pubRef, { ...data, publishedAt: serverTimestamp() }, { merge: true });
}

function renderContactPreview(items, emptyMessage) {
  return (items || [])
    .map((x) => {
      return `
        <div style="border:1px solid var(--border); border-radius:12px; padding:12px; background:#fff;">
          <div style="font-weight:600;">${escapeHtml(x.title || "")}</div>
          <div>${escapeHtml(x.name || "")}</div>
          <div class="muted small">${escapeHtml(x.email || "")}</div>
          <div class="muted small">${escapeHtml(x.phone || "")}</div>
        </div>
      `;
    })
    .join("") || `<div class="muted">${emptyMessage}</div>`;
}

function renderHomepagePreview(draft) {
  const items = (draft.keyDates || [])
    .map((x) => {
      const date = x.date ? `<div class="muted small">${x.date}</div>` : "";
      const body = x.body ? `<div class="muted">${escapeHtml(x.body)}</div>` : "";
      const link = x.linkUrl
        ? `<div><a href="${escapeAttr(x.linkUrl)}" target="_blank" rel="noreferrer">Link</a></div>`
        : "";

      return `
        <div style="border:1px solid var(--border); border-radius:12px; padding:12px; background:#fff;">
          <div style="font-weight:600;">${escapeHtml(x.title || "")}</div>
          ${date}
          ${body}
          ${link}
        </div>
      `;
    })
    .join("");

  return `
    <h3 style="margin:12px 0 8px;">Preview</h3>

    <h4 style="margin:10px 0 8px;">Key Dates & News</h4>
    <div style="display:grid; gap:10px;">${items || `<div class="muted">No items yet.</div>`}</div>

    <h4 style="margin:14px 0 8px;">Community Manager Contact</h4>
    <div style="display:grid; gap:10px;">
      ${renderContactPreview(draft.communityManagerContacts, "No contacts yet.")}
    </div>

    <h4 style="margin:14px 0 8px;">Board</h4>
    <div style="display:grid; gap:10px;">
      ${renderContactPreview(draft.boardMembers, "No board members yet.")}
    </div>
  `;
}

function renderContactEditorSection(sectionId, heading, addLabel) {
  return `
    <h4 style="margin:0 0 10px;">${heading}</h4>
    <div id="${sectionId}List" style="display:grid; gap:10px;"></div>
    <button id="add${sectionId}" class="secondary" style="margin-top:10px;">${addLabel}</button>
  `;
}

function renderContactCards(items, key) {
  return (items || [])
    .map((item, idx) => {
      return `
        <div style="border:1px solid var(--border); border-radius:12px; padding:12px; background:#fff;">
          <div style="display:flex; justify-content:space-between; gap:10px; align-items:center;">
            <div style="font-weight:600;">Item ${idx + 1}</div>
            <button data-${key}-del="${idx}" class="secondary">Remove</button>
          </div>

          <div style="display:grid; gap:10px; margin-top:10px;">
            <label>Title/Role <input data-${key}-title="${idx}" value="${escapeAttr(item.title || "")}" /></label>
            <label>Name <input data-${key}-name="${idx}" value="${escapeAttr(item.name || "")}" /></label>
            <label>Email <input data-${key}-email="${idx}" value="${escapeAttr(item.email || "")}" /></label>
            <label>Phone <input data-${key}-phone="${idx}" value="${escapeAttr(item.phone || "")}" /></label>
          </div>
        </div>
      `;
    })
    .join("");
}

function bindContactInputs(editorArea, draft, key) {
  editorArea.querySelectorAll(`input[data-${key}-title]`).forEach((inp) => {
    inp.addEventListener("input", () => {
      const i = Number(inp.getAttribute(`data-${key}-title`));
      draft[key][i].title = inp.value;
      document.getElementById("previewPanel").innerHTML = renderHomepagePreview(draft);
    });
  });

  editorArea.querySelectorAll(`input[data-${key}-name]`).forEach((inp) => {
    inp.addEventListener("input", () => {
      const i = Number(inp.getAttribute(`data-${key}-name`));
      draft[key][i].name = inp.value;
      document.getElementById("previewPanel").innerHTML = renderHomepagePreview(draft);
    });
  });

  editorArea.querySelectorAll(`input[data-${key}-email]`).forEach((inp) => {
    inp.addEventListener("input", () => {
      const i = Number(inp.getAttribute(`data-${key}-email`));
      draft[key][i].email = inp.value;
      document.getElementById("previewPanel").innerHTML = renderHomepagePreview(draft);
    });
  });

  editorArea.querySelectorAll(`input[data-${key}-phone]`).forEach((inp) => {
    inp.addEventListener("input", () => {
      const i = Number(inp.getAttribute(`data-${key}-phone`));
      draft[key][i].phone = inp.value;
      document.getElementById("previewPanel").innerHTML = renderHomepagePreview(draft);
    });
  });
}

function bindContactDeletes(editorArea, draft, key) {
  editorArea.querySelectorAll(`[data-${key}-del]`).forEach((btn) => {
    btn.addEventListener("click", () => {
      const i = Number(btn.getAttribute(`data-${key}-del`));
      draft[key].splice(i, 1);
      rerenderPreviewOnly(draft);
      renderHomepageEditorState(editorArea, draft, key);
    });
  });
}

function rerenderPreviewOnly(draft) {
  document.getElementById("previewPanel").innerHTML = renderHomepagePreview(draft);
}

function renderHomepageEditorState(editorArea, draft, changedSection) {
  const sectionsToRender = changedSection
    ? [changedSection]
    : ["communityManagerContacts", "boardMembers"];

  sectionsToRender.forEach((sectionId) => {
    const listEl = document.getElementById(`${sectionId}List`);
    listEl.innerHTML = renderContactCards(draft[sectionId] || [], sectionId);
  });

  sectionsToRender.forEach((sectionId) => {
    bindContactDeletes(editorArea, draft, sectionId);
    bindContactInputs(editorArea, draft, sectionId);
  });
}

function getPreviewUrl(siteUrl) {
  const raw = (siteUrl || "").trim();
  if (!raw) return "";

  const withProtocol = /^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`;

  try {
    const url = new URL(withProtocol);
    url.searchParams.set("preview", "1");
    return url.toString();
  } catch {
    return "";
  }
}

async function renderHomepageEditor(communityId, community) {
  const editorArea = document.getElementById("editorArea");
  editorArea.innerHTML = `<p class="muted">Loading homepage draft...</p>`;

  let draft = await loadHomepageDraft(communityId);

  function rerender() {
    editorArea.innerHTML = `
      <div style="display:flex; align-items:center; justify-content:space-between; gap:12px;">
        <h3 style="margin:0;">Homepage Editor</h3>
        <div style="display:flex; gap:10px; flex-wrap:wrap;">
          <button id="btnSaveDraft">Save Draft</button>
          <button id="btnPublish" class="secondary">Publish</button>
          <button id="btnPreviewSite" class="secondary">Open Site Preview</button>
        </div>
      </div>

      <hr/>

      <h4 style="margin:0 0 10px;">Key Dates & News</h4>
      <div id="keyDatesList" style="display:grid; gap:10px;"></div>
      <button id="addKeyDate" class="secondary" style="margin-top:10px;">+ Add Key Date / News Item</button>

      <hr/>

      ${renderContactEditorSection(
        "communityManagerContacts",
        "Community Manager Contact",
        "+ Add Community Manager Contact"
      )}

      <hr/>

      ${renderContactEditorSection("boardMembers", "Board", "+ Add Board Member")}

      <hr/>

      <div id="previewPanel">${renderHomepagePreview(draft)}</div>
    `;

    const kd = document.getElementById("keyDatesList");
    kd.innerHTML = (draft.keyDates || [])
      .map((item, idx) => {
        return `
          <div style="border:1px solid var(--border); border-radius:12px; padding:12px; background:#fff;">
            <div style="display:flex; justify-content:space-between; gap:10px; align-items:center;">
              <div style="font-weight:600;">Item ${idx + 1}</div>
              <button data-kd-del="${idx}" class="secondary">Remove</button>
            </div>

            <div style="display:grid; gap:10px; margin-top:10px;">
              <label>Title <input data-kd-title="${idx}" value="${escapeAttr(item.title || "")}" /></label>
              <label>Date <input data-kd-date="${idx}" type="date" value="${escapeAttr(item.date || "")}" /></label>
              <label>Details <input data-kd-body="${idx}" value="${escapeAttr(item.body || "")}" /></label>
              <label>Link (optional) <input data-kd-link="${idx}" value="${escapeAttr(item.linkUrl || "")}" /></label>
            </div>
          </div>
        `;
      })
      .join("");

    renderHomepageEditorState(editorArea, draft);

    document.getElementById("addKeyDate").onclick = () => {
      draft.keyDates = draft.keyDates || [];
      draft.keyDates.push({ title: "", date: "", body: "", linkUrl: "" });
      rerender();
    };

    document.getElementById("addcommunityManagerContacts").onclick = () => {
      draft.communityManagerContacts = draft.communityManagerContacts || [];
      draft.communityManagerContacts.push({ title: "", name: "", email: "", phone: "" });
      rerender();
    };

    document.getElementById("addboardMembers").onclick = () => {
      draft.boardMembers = draft.boardMembers || [];
      draft.boardMembers.push({ title: "", name: "", email: "", phone: "" });
      rerender();
    };

    editorArea.querySelectorAll("[data-kd-del]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const i = Number(btn.getAttribute("data-kd-del"));
        draft.keyDates.splice(i, 1);
        rerender();
      });
    });

    editorArea.querySelectorAll("input[data-kd-title]").forEach((inp) => {
      inp.addEventListener("input", () => {
        const i = Number(inp.getAttribute("data-kd-title"));
        draft.keyDates[i].title = inp.value;
        rerenderPreviewOnly(draft);
      });
    });

    editorArea.querySelectorAll("input[data-kd-date]").forEach((inp) => {
      inp.addEventListener("input", () => {
        const i = Number(inp.getAttribute("data-kd-date"));
        draft.keyDates[i].date = inp.value;
        rerenderPreviewOnly(draft);
      });
    });

    editorArea.querySelectorAll("input[data-kd-body]").forEach((inp) => {
      inp.addEventListener("input", () => {
        const i = Number(inp.getAttribute("data-kd-body"));
        draft.keyDates[i].body = inp.value;
        rerenderPreviewOnly(draft);
      });
    });

    editorArea.querySelectorAll("input[data-kd-link]").forEach((inp) => {
      inp.addEventListener("input", () => {
        const i = Number(inp.getAttribute("data-kd-link"));
        draft.keyDates[i].linkUrl = inp.value;
        rerenderPreviewOnly(draft);
      });
    });

    document.getElementById("btnSaveDraft").onclick = async () => {
      await saveHomepageDraft(communityId, draft);
      alert("Draft saved.");
    };

    document.getElementById("btnPublish").onclick = async () => {
      await saveHomepageDraft(communityId, draft);
      await publishHomepage(communityId);
      alert("Published.");
    };

    document.getElementById("btnPreviewSite").onclick = async () => {
      const url = getPreviewUrl(community.siteUrl);

      if (!url) {
        alert("Missing or invalid site URL for this community.");
        return;
      }

      const previewWindow = window.open("about:blank", "_blank");
      if (!previewWindow) {
        alert("The preview window was blocked. Please allow pop-ups and try again.");
        return;
      }

      try {
        previewWindow.document.write(`
          <title>Preparing Preview</title>
          <div style="font-family:sans-serif;padding:16px;">Preparing preview...</div>
        `);
        previewWindow.document.close();
        await saveHomepageDraft(communityId, draft);
        previewWindow.location.href = url;
      } catch (err) {
        previewWindow.document.body.innerHTML = `
          <div style="font-family:sans-serif;padding:16px;">
            Preview could not be prepared. Please save the draft and try again.
          </div>
        `;
        alert(err?.message || "Preview could not be prepared.");
      }
    };
  }

  rerender();
}

function escapeHtml(str) {
  return String(str || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(str) {
  return escapeHtml(str).replaceAll("`", "&#096;");
}

onAuthStateChanged(auth, (user) => {
  if (user) {
    renderDashboard(user).catch((e) => renderLogin(e.message));
  } else {
    renderLogin();
  }
});
