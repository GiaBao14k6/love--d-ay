// Flexible BASE_URL: use window.__API_BASE_URL if set, otherwise use window.location.origin for local development
const BASE_URL = (typeof window !== 'undefined' && window.__API_BASE_URL) ? window.__API_BASE_URL : (typeof window !== 'undefined' ? window.location.origin : "https://love-d-ay-2.onrender.com");
const API_BASE_URL = BASE_URL + "/api/diary";

let currentEntryId = null;
let currentCommentId = null;
let isReplying = false;
let isEditCommentMode = false;
let currentMediaIndex = 0;
let currentMediaList = [];
let currentMediaType = "img";
let likeClickTime = 0;

let currentPage = 1;
const PAGE_SIZE = 5;
let totalPages = 1;
let isLoading = false;

let oldMediaList = [];

function escapeHTML(str) {
  if (!str) return '';
  return str.replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
}

function authHeaders(headers = {}) {
  const token = localStorage.getItem('jwt_token');
  if (token) return { ...headers, 'Authorization': 'Bearer ' + token };
  return headers;
}

document.addEventListener('DOMContentLoaded', () => {
  setupAppEvents();
  currentPage = 1;
  fetchDiaryEntries(currentPage);

  updateTogetherTimer();
  setInterval(updateTogetherTimer, 1000);

  const loginModal = document.getElementById('login-modal');
  const loginForm = document.getElementById('login-form');
  const loginError = document.getElementById('login-error');

  function showLogin() {
    loginModal.style.display = 'flex';
  }
  function hideLogin() {
    loginModal.style.display = 'none';
  }

  if (localStorage.getItem('jwt_token')) {
    hideLogin();
  } else {
    showLogin();
  }

  loginForm.onsubmit = async function(e) {
    e.preventDefault();
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value.trim();
    try {
      const resp = await fetch(BASE_URL + '/api/login', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ username, password })
      });
      let data;
      try {
        data = await resp.json();
      } catch {
        loginError.style.display = 'block';
        loginError.textContent = 'Server trả về phản hồi không hợp lệ!';
        return;
      }
      if (resp.ok && data.token) {
        localStorage.setItem('jwt_token', data.token);
        hideLogin();
        location.reload();
      } else {
        loginError.style.display = 'block';
        loginError.textContent = data.message || 'Tên đăng nhập hoặc mật khẩu không đúng!';
      }
    } catch {
      loginError.style.display = 'block';
      loginError.textContent = 'Không kết nối được server!';
    }
  };
});

function setupAppEvents() {
  document.getElementById('diary-form').addEventListener('submit', handleFormSubmit);
  document.getElementById('cancel-edit-btn').addEventListener('click', cancelEdit);

  document.querySelectorAll('.close-btn, .close-btn-full').forEach(btn => {
    btn.onclick = (e) => {
      const modalId = e.target.dataset.modal;
      document.getElementById(modalId).style.display = 'none';
      if (modalId === 'full-entry-modal') {
        document.querySelectorAll("#media-slider-inner video").forEach(v => v.pause());
      }
    };
  });

  window.onclick = (event) => {
    if (event.target == document.getElementById('delete-modal')) document.getElementById('delete-modal').style.display = 'none';
    if (event.target == document.getElementById('full-entry-modal')) {
      document.getElementById('full-entry-modal').style.display = 'none';
      document.querySelectorAll("#media-slider-inner video").forEach(v => v.pause());
    }
    if (event.target == document.getElementById('comment-modal')) document.getElementById('comment-modal').style.display = 'none';
    if (event.target == document.getElementById('zoom-media-modal')) {
      document.getElementById('zoom-media-modal').style.display = 'none';
      document.getElementById('zoom-media-display').innerHTML = "";
    }
  };

  document.getElementById('confirm-delete-btn').onclick = async () => {
    if (window.entryToDeleteId) {
      await deleteDiaryEntry(window.entryToDeleteId);
      document.getElementById('delete-modal').style.display = 'none';
    }
  };
  document.getElementById('cancel-delete-btn').onclick = () => {
    document.getElementById('delete-modal').style.display = 'none';
  };

  document.getElementById('diary-entries-grid').addEventListener('click', (e) => {
    const target = e.target.closest('.edit-btn, .delete-btn, .diary-entry');
    if (!target) return;
    const entryDiv = target.closest('.diary-entry');
    const entryId = entryDiv.dataset.id;
    if (target.classList.contains('edit-btn')) {
      e.stopPropagation();
      editDiaryEntry(entryId);
    } else if (target.classList.contains('delete-btn')) {
      e.stopPropagation();
      window.entryToDeleteId = entryId;
      document.getElementById('delete-modal').style.display = 'flex';
    } else if (target.classList.contains('diary-entry')) {
      showFullEntryModal(entryId);
    }
  });

  document.getElementById('pagination-controls').addEventListener('click', function(e) {
    if (e.target.classList.contains('page-btn') && !e.target.disabled) {
      const page = parseInt(e.target.dataset.page, 10);
      if (page && page !== currentPage) {
        currentPage = page;
        fetchDiaryEntries(currentPage);
      }
    }
  });

  const likeBtn = document.getElementById('full-modal-like-btn');
  likeBtn.addEventListener('click', handleLikeClick);
  likeBtn.addEventListener('dblclick', handleLikeDoubleClick);

  document.getElementById('full-modal-comment-btn').addEventListener('click', () => {
    if (currentEntryId) openCommentModal(currentEntryId, null);
  });

  document.getElementById('submit-comment-btn').addEventListener('click', async () => {
    const author = document.getElementById('comment-author').value;
    const content = document.getElementById('comment-text').value;
    if (isEditCommentMode && currentEntryId && currentCommentId) {
      await editComment(currentEntryId, currentCommentId, author, content);
      document.getElementById('comment-modal').style.display = 'none';
      await showFullEntryModal(currentEntryId);
      isEditCommentMode = false;
      return;
    }
    if (isReplying && currentEntryId && currentCommentId) {
      submitReply(currentEntryId, currentCommentId, author, content);
    } else if (currentEntryId) {
      submitComment(currentEntryId, author, content);
    }
  });

  document.getElementById('comments-list').addEventListener('click', async (e) => {
    const replyBtn = e.target.closest('.reply-btn');
    const editBtn = e.target.closest('.edit-comment-btn');
    const deleteBtn = e.target.closest('.delete-comment-btn');
    if (replyBtn) {
      const entryId = replyBtn.dataset.entryId;
      const commentId = replyBtn.dataset.commentId;
      openCommentModal(entryId, commentId);
    }
    if (editBtn) {
      const entryId = editBtn.dataset.entryId;
      const commentId = editBtn.dataset.commentId;
      const commentContent = editBtn.dataset.commentContent;
      const author = editBtn.dataset.author;
      openEditCommentModal(entryId, commentId, author, commentContent);
    }
    if (deleteBtn) {
      const entryId = deleteBtn.dataset.entryId;
      const commentId = deleteBtn.dataset.commentId;
      if (confirm("Bạn có chắc muốn xóa bình luận này?")) {
        await deleteComment(entryId, commentId);
        await showFullEntryModal(entryId);
      }
    }
  });

  document.getElementById('selected-files-list').innerHTML = '';
  const mediaUploadInput = document.getElementById('media-upload');
  const fileLabel = document.querySelector('.file-upload-label');
  const selectedFilesList = document.getElementById('selected-files-list');
  mediaUploadInput.addEventListener('change', () => {
    if (mediaUploadInput.files.length > 0) {
      let names = [];
      for (let file of mediaUploadInput.files) names.push(file.name);
      fileLabel.textContent = `✅ ${names.join(', ')}`;
      selectedFilesList.innerHTML = names.map(name => `<div>${name}</div>`).join('');
    } else {
      fileLabel.innerHTML = '<span class="upload-icon">🏞️</span> Thêm ảnh/video';
      selectedFilesList.innerHTML = '';
    }
  });

  document.getElementById('old-media-list').addEventListener('click', function(e) {
    if (e.target.classList.contains('old-media-remove')) {
      const filename = e.target.dataset.filename;
      oldMediaList = oldMediaList.filter(f => f !== filename);
      renderOldMediaList();
    }
  });

  document.getElementById('close-zoom-media').onclick = function() {
    document.getElementById('zoom-media-modal').style.display = 'none';
    document.getElementById('zoom-media-display').innerHTML = "";
  };
}

async function fetchDiaryEntries(page = 1, append = false) {
  if (isLoading) return;
  isLoading = true;
  try {
    const response = await fetch(`${API_BASE_URL}?page=${page}&limit=${PAGE_SIZE}`);
    if (!response.ok) {
      let errorData;
      try {
        errorData = await response.json();
      } catch {
        errorData = { message: 'Lỗi không xác định từ server.' };
      }
      showNotification(errorData.message || 'Không thể tải nhật ký.', true);
      isLoading = false;
      return;
    }
    const data = await response.json();
    if (append) {
      appendDiaryEntries(data.entries);
    } else {
      renderDiaryEntries(data.entries);
      document.getElementById('diary-entries-grid').scrollTop = 0;
    }
    totalPages = data.totalPages;
    renderPaginationControls(page, totalPages);
  } catch (err) {
    showNotification('Không thể kết nối máy chủ!', true);
  }
  isLoading = false;
}

function renderPaginationControls(current, total) {
  const pagination = document.getElementById('pagination-controls');
  let html = '';
  for (let i = 1; i <= total; i++) {
    html += `<button class="page-btn" data-page="${i}"${i === current ? ' disabled' : ''}>${i}</button>`;
  }
  pagination.innerHTML = html;
}

function appendDiaryEntries(entries) {
  const container = document.getElementById('diary-entries-grid');
  entries.forEach(entry => {
    const entryDiv = createDiaryEntryDiv(entry);
    container.appendChild(entryDiv);
  });
}

function renderDiaryEntries(entries) {
  const container = document.getElementById('diary-entries-grid');
  container.innerHTML = '';
  entries.forEach(entry => {
    const entryDiv = createDiaryEntryDiv(entry);
    container.appendChild(entryDiv);
  });
}

function createDiaryEntryDiv(entry) {
  const entryDiv = document.createElement('div');
  entryDiv.className = 'diary-entry';
  entryDiv.dataset.id = entry._id;
  let mediaHtml = '';
  if (Array.isArray(entry.media) && entry.media.length > 0) {
    const firstFile = entry.media[0];
    const ext = firstFile.split('.').pop().toLowerCase();
    const isVideo = ['mp4', 'mov', 'webm'].includes(ext);
    if (isVideo) mediaHtml = `<video src="${BASE_URL}/uploads/${firstFile}"></video>`;
    else mediaHtml = `<img src="${BASE_URL}/uploads/${firstFile}" alt="Kỷ niệm">`;
  }
  entryDiv.innerHTML = `
    <div class="entry-actions">
      <button class="edit-btn" data-id="${entry._id}">✏️</button>
      <button class="delete-btn" data-id="${entry._id}">❌</button>
    </div>
    <span class="entry-date">${new Date(entry.date).toLocaleDateString('vi-VN')}</span>
    <div class="diary-entry-image-container" data-id="${entry._id}">
      ${mediaHtml}
    </div>
    <h3>${escapeHTML(entry.title)}</h3>
    <p>${escapeHTML(entry.content)}</p>
    <div class="diary-entry-footer">
      <span class="like-count">❤️ ${entry.likes || 0}</span>
      <span>💬 ${entry.comments.length || 0} bình luận</span>
    </div>
  `;
  return entryDiv;
}

async function showFullEntryModal(id) {
  try {
    const response = await fetch(`${API_BASE_URL}/${id}`);
    if (!response.ok) {
      let errorData;
      try {
        errorData = await response.json();
      } catch {
        errorData = { message: 'Lỗi không xác định từ server.' };
      }
      showNotification(errorData.message || 'Không thể tải chi tiết.', true);
      return;
    }
    const entry = await response.json();
    currentEntryId = id;
    document.getElementById('full-modal-title').textContent = entry.title;
    document.getElementById('full-modal-author').textContent = entry.author;
    document.getElementById('full-modal-date').textContent = new Date(entry.date).toLocaleDateString('vi-VN');
    document.getElementById('full-modal-content').textContent = entry.content;
    document.getElementById('full-modal-likes').textContent = entry.likes || 0;
    currentMediaList = Array.isArray(entry.media) ? entry.media : [];
    currentMediaIndex = 0;
    renderMediaSlider();
    document.getElementById('media-prev-btn').onclick = function() {
      if (currentMediaList.length > 0) {
        currentMediaIndex = (currentMediaIndex - 1 + currentMediaList.length) % currentMediaList.length;
        renderMediaSlider();
      }
    };
    document.getElementById('media-next-btn').onclick = function() {
      if (currentMediaList.length > 0) {
        currentMediaIndex = (currentMediaIndex + 1) % currentMediaList.length;
        renderMediaSlider();
      }
    };
    renderComments(entry.comments, id);
    document.getElementById('full-entry-modal').style.display = 'flex';
  } catch (err) {
    showNotification('Không thể kết nối máy chủ!', true);
  }
}

function renderMediaSlider() {
  const inner = document.getElementById('media-slider-inner');
  inner.innerHTML = '';
  if (currentMediaList.length === 0) return;
  const file = currentMediaList[currentMediaIndex];
  const ext = file.split('.').pop().toLowerCase();
  const isVideo = ['mp4', 'mov', 'webm'].includes(ext);
  const url = `${BASE_URL}/uploads/${file}`;
  if (isVideo) {
    const v = document.createElement('video');
    v.src = url;
    v.controls = true;
    v.autoplay = false;
    v.style.maxWidth = "900px";
    v.style.maxHeight = "80vh";
    v.style.background = "#222";
    v.onclick = () => openZoomMedia(file, "video");
    inner.appendChild(v);
    currentMediaType = "video";
  } else {
    const img = document.createElement('img');
    img.src = url;
    img.alt = "Kỷ niệm";
    img.style.maxWidth = "900px";
    img.style.maxHeight = "80vh";
    img.style.background = "#222";
    img.onclick = () => openZoomMedia(file, "img");
    inner.appendChild(img);
    currentMediaType = "img";
  }
}

function openZoomMedia(file, type) {
  const zoomDisplay = document.getElementById('zoom-media-display');
  zoomDisplay.innerHTML = "";
  const url = `${BASE_URL}/uploads/${file}`;
  if (type === "video") {
    const v = document.createElement('video');
    v.src = url;
    v.controls = true;
    v.autoplay = true;
    v.style.maxWidth = "92vw";
    v.style.maxHeight = "92vh";
    v.style.background = "#222";
    zoomDisplay.appendChild(v);
  } else {
    const img = document.createElement('img');
    img.src = url;
    img.alt = "Kỷ niệm";
    img.style.maxWidth = "92vw";
    img.style.maxHeight = "92vh";
    img.style.background = "#222";
    zoomDisplay.appendChild(img);
  }
  document.getElementById('zoom-media-modal').style.display = 'flex';
}

function handleLikeClick() {
  likeClickTime = Date.now();
  likeEntry(currentEntryId);
}

function handleLikeDoubleClick(e) {
  e.preventDefault();
  dislikeEntry(currentEntryId);
}

async function likeEntry(id) {
  try {
    const response = await fetch(`${API_BASE_URL}/${id}/like`, {method: 'POST'});
    if (response.ok) {
      const data = await response.json();
      document.getElementById('full-modal-likes').textContent = data.likes;
      fetchDiaryEntries(1);
    } else {
      const errorData = await response.json();
      showNotification(errorData.message || 'Lỗi like.', true);
    }
  } catch (err) {
    showNotification('Không thể kết nối máy chủ!', true);
  }
}

async function dislikeEntry(id) {
  try {
    const response = await fetch(`${API_BASE_URL}/${id}/dislike`, {method: 'POST'});
    if (response.ok) {
      const data = await response.json();
      document.getElementById('full-modal-likes').textContent = data.likes;
      fetchDiaryEntries(1);
    } else {
      const errorData = await response.json();
      showNotification(errorData.message || 'Lỗi dislike.', true);
    }
  } catch (err) {
    showNotification('Không thể kết nối máy chủ!', true);
  }
}

async function openCommentModal(entryId, commentId) {
  currentEntryId = entryId;
  currentCommentId = commentId;
  isReplying = !!commentId;
  isEditCommentMode = false;
  document.getElementById('comment-text').value = '';
  if (isReplying) {
    document.getElementById('comment-modal-title').textContent = 'Trả lời bình luận';
  } else {
    document.getElementById('comment-modal-title').textContent = 'Thêm bình luận';
  }
  document.getElementById('comment-modal').style.display = 'flex';
}

function openEditCommentModal(entryId, commentId, author, content) {
  currentEntryId = entryId;
  currentCommentId = commentId;
  isReplying = false;
  isEditCommentMode = true;
  document.getElementById('comment-text').value = content;
  document.getElementById('comment-modal-title').textContent = 'Chỉnh sửa bình luận';
  document.getElementById('comment-modal').style.display = 'flex';
}

async function submitComment(entryId, author, content) {
  if (!content.trim()) return showNotification('Nội dung bình luận không được để trống.', true);
  try {
    const response = await fetch(`${API_BASE_URL}/${entryId}/comment`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ author, content })
    });
    if (response.ok) {
      document.getElementById('comment-modal').style.display = 'none';
      await showFullEntryModal(entryId);
    } else {
      const errorData = await response.json();
      showNotification(errorData.message || 'Có lỗi xảy ra, vui lòng thử lại.', true);
    }
  } catch (err) {
    showNotification('Không thể kết nối máy chủ!', true);
  }
}

async function submitReply(entryId, commentId, author, content) {
  if (!content.trim()) return showNotification('Nội dung trả lời không được để trống.', true);
  try {
    const response = await fetch(`${API_BASE_URL}/${entryId}/comment/${commentId}/reply`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ author, content })
    });
    if (response.ok) {
      document.getElementById('comment-modal').style.display = 'none';
      await showFullEntryModal(entryId);
    } else {
      const errorData = await response.json();
      showNotification(errorData.message || 'Có lỗi xảy ra khi trả lời.', true);
    }
  } catch (err) {
    showNotification('Không thể kết nối máy chủ!', true);
  }
}

async function editComment(entryId, commentId, author, content) {
  if (!content.trim()) return showNotification('Nội dung chỉnh sửa không được để trống.', true);
  try {
    const response = await fetch(`${API_BASE_URL}/${entryId}/comment/${commentId}`, {
      method: 'PUT',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ author, content })
    });
    if (!response.ok) {
      const errorData = await response.json();
      showNotification(errorData.message || 'Có lỗi khi chỉnh sửa.', true);
    }
  } catch (err) {
    showNotification('Không thể kết nối máy chủ!', true);
  }
}

async function deleteComment(entryId, commentId) {
  try {
    const response = await fetch(`${API_BASE_URL}/${entryId}/comment/${commentId}`, {method: 'DELETE'});
    if (!response.ok) {
      const errorData = await response.json();
      showNotification(errorData.message || 'Có lỗi khi xóa bình luận.', true);
    }
  } catch (err) {
    showNotification('Không thể kết nối máy chủ!', true);
  }
}

function renderComments(comments, entryId) {
  const list = document.getElementById('comments-list');
  list.innerHTML = '';
  comments.forEach(comment => {
    const commentEl = document.createElement('div');
    commentEl.className = 'comment';
    commentEl.innerHTML = `
      <div class="comment-header">
        <span class="author-name">${escapeHTML(comment.author)}</span>
        <span style="float: right; font-weight: normal; font-size: 0.9em;">${new Date(comment.createdAt).toLocaleDateString('vi-VN')}</span>
      </div>
      <div class="comment-content">${escapeHTML(comment.content)}</div>
      <div class="comment-footer">
        <button class="reply-btn" data-entry-id="${entryId}" data-comment-id="${comment._id}">Trả lời</button>
        <button class="edit-comment-btn" data-entry-id="${entryId}" data-comment-id="${comment._id}" data-author="${escapeHTML(comment.author)}" data-comment-content="${escapeHTML(comment.content)}">Sửa</button>
        <button class="delete-comment-btn" data-entry-id="${entryId}" data-comment-id="${comment._id}">Xóa</button>
      </div>
      <div class="replies-list" id="replies-for-${comment._id}"></div>
    `;
    list.appendChild(commentEl);
    const repliesList = document.getElementById(`replies-for-${comment._id}`);
    comment.replies.forEach(reply => {
      const replyEl = document.createElement('div');
      replyEl.className = 'reply';
      replyEl.innerHTML = `
        <div class="comment-header">
          <span class="author-name">${escapeHTML(reply.author)}</span> (Trả lời)
          <span style="float: right; font-weight: normal; font-size: 0.9em;">${new Date(reply.createdAt).toLocaleDateString('vi-VN')}</span>
        </div>
        <div class="comment-content">${escapeHTML(reply.content)}</div>
      `;
      repliesList.appendChild(replyEl);
    });
  });
}

async function handleFormSubmit(event) {
  event.preventDefault();
  const entryId = document.getElementById('entry-id').value;
  const date = document.getElementById('date').value;
  const author = document.getElementById('author').value;
  const title = document.getElementById('title').value;
  const content = document.getElementById('content').value;
  const mediaFiles = document.getElementById('media-upload').files;
  const formData = new FormData();
  formData.append('date', date);
  formData.append('author', author);
  formData.append('title', title);
  formData.append('content', content);
  if (entryId) {
    for (let name of oldMediaList) formData.append('mediaToKeep', name);
  }
  for (let i = 0; i < mediaFiles.length; i++) formData.append('media', mediaFiles[i]);
  let response;
  try {
    const opts = {
      method: entryId ? 'PUT' : 'POST',
      body: formData,
      headers: authHeaders()
    };
    response = await fetch(
      entryId ? `${API_BASE_URL}/${entryId}` : API_BASE_URL,
      opts
    );
    if (response.ok) {
      showNotification('Kỷ niệm đã được lưu lại!');
      resetForm();
      currentPage = 1;
      fetchDiaryEntries(currentPage);
    } else {
      let errorData;
      try {
        errorData = await response.json();
      } catch {
        errorData = { message: 'Lỗi không xác định từ server.' };
      }
      showNotification(errorData.message || 'Có lỗi xảy ra, vui lòng thử lại.', true);
    }
  } catch (err) {
    showNotification('Không thể kết nối máy chủ!', true);
  }
}

async function editDiaryEntry(id) {
  try {
    const response = await fetch(`${API_BASE_URL}/${id}`);
    if (!response.ok) {
      let errorData;
      try {
        errorData = await response.json();
      } catch {
        errorData = { message: 'Lỗi không xác định từ server.' };
      }
      showNotification(errorData.message || 'Không thể lấy thông tin nhật ký.', true);
      return;
    }
    const entry = await response.json();
    document.getElementById('entry-id').value = entry._id;
    
    // Safe date parsing with try/catch
    try {
      const dateValue = new Date(entry.date).toISOString().split('T')[0];
      document.getElementById('date').value = dateValue;
    } catch (err) {
      console.error('Error parsing date:', err);
      document.getElementById('date').value = new Date().toISOString().split('T')[0];
    }
    
    document.getElementById('author').value = entry.author;
    document.getElementById('title').value = entry.title;
    document.getElementById('content').value = entry.content;
    document.getElementById('submit-btn').textContent = 'Cập nhật';
    document.getElementById('cancel-edit-btn').style.display = 'inline-block';
    document.querySelector('.file-upload-label').innerHTML = '<span class="upload-icon">🏞️</span> Thêm ảnh/video';
    document.getElementById('selected-files-list').innerHTML = '';
    document.getElementById('media-upload').value = '';
    oldMediaList = Array.isArray(entry.media) ? [...entry.media] : [];
    renderOldMediaList();
  } catch (err) {
    showNotification('Không thể kết nối máy chủ!', true);
  }
}

function renderOldMediaList() {
  const list = document.getElementById('old-media-list');
  list.innerHTML = '';
  oldMediaList.forEach(filename => {
    const ext = filename.split('.').pop().toLowerCase();
    const isVideo = ['mp4', 'mov', 'webm'].includes(ext);
    let thumb;
    if (isVideo)
      thumb = `<video src="${BASE_URL}/uploads/${filename}" muted></video>`;
    else
      thumb = `<img src="${BASE_URL}/uploads/${filename}" alt="">`;
    list.innerHTML += `
      <div class="old-media-item">
        ${thumb}
        <span>${filename}</span>
        <button class="old-media-remove" type="button" data-filename="${filename}" title="Xóa file này">×</button>
      </div>
    `;
  });
}

function cancelEdit() {
  resetForm();
}

function resetForm() {
  document.getElementById('diary-form').reset();
  document.getElementById('entry-id').value = '';
  document.getElementById('submit-btn').textContent = 'Lưu lại';
  document.getElementById('cancel-edit-btn').style.display = 'none';
  document.querySelector('.file-upload-label').innerHTML = '<span class="upload-icon">🏞️</span> Thêm ảnh/video';
  document.getElementById('selected-files-list').innerHTML = '';
  document.getElementById('media-upload').value = '';
  oldMediaList = [];
  renderOldMediaList();
}

async function deleteDiaryEntry(id) {
  try {
    const resp = await fetch(`${API_BASE_URL}/${id}`, {
      method: 'DELETE',
      headers: authHeaders()
    });
    if (resp.ok) {
      showNotification('Kỷ niệm đã được xóa!');
      currentPage = 1;
      fetchDiaryEntries(currentPage);
    } else {
      let errorData;
      try {
        errorData = await resp.json();
      } catch {
        errorData = { message: 'Lỗi không xác định từ server.' };
      }
      showNotification(errorData.message || 'Có lỗi xảy ra, vui lòng thử lại.', true);
    }
  } catch (err) {
    showNotification('Không thể kết nối máy chủ!', true);
  }
}

function showNotification(message, isError = false) {
  const notification = document.getElementById('notification-message');
  notification.textContent = message;
  notification.className = isError ? 'notification error' : 'notification success';
  notification.style.display = 'block';
  setTimeout(() => {
    notification.style.display = 'none';
  }, 5000);
}

const TOGETHER_START_DATE = new Date('2023-02-04T00:00:00');

function updateTogetherTimer() {
  const now = new Date();
  let diff = Math.floor((now - TOGETHER_START_DATE) / 1000); 
  const years = Math.floor(diff / (365.2425 * 24 * 3600));
  diff -= Math.floor(years * 365.2425 * 24 * 3600);
  const months = Math.floor(diff / (30.44 * 24 * 3600));
  diff -= Math.floor(months * 30.44 * 24 * 3600);
  const days = Math.floor(diff / (24 * 3600));
  diff -= days * 24 * 3600;
  const hours = Math.floor(diff / 3600);
  diff -= hours * 3600;
  const minutes = Math.floor(diff / 60);
  const seconds = diff - minutes * 60;
  function pad(num) { return num.toString().padStart(2, '0'); }
  document.getElementById('timer-value').textContent =
    `${years} năm ${months} tháng ${days} ngày ${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}