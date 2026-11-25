<template>
  <div class="admin-page">
    <header class="admin-head">
      <div>
        <h1>用户审核与权限管理</h1>
        <p>审核注册申请、启用或停用账号、设置管理员角色</p>
      </div>
      <div class="head-actions">
        <button type="button" class="ghost" @click="router.push('/')">返回主界面</button>
        <button type="button" class="ghost" @click="router.push('/profile')">个人中心</button>
        <button type="button" class="primary" :disabled="loading" @click="load">刷新</button>
      </div>
    </header>

    <div class="stats">
      <div class="stat"><span>用户总数</span><strong>{{ stats.total || 0 }}</strong></div>
      <div class="stat pending"><span>待审核</span><strong>{{ stats.pending || 0 }}</strong></div>
      <div class="stat"><span>正常</span><strong>{{ stats.active || 0 }}</strong></div>
      <div class="stat"><span>已停用</span><strong>{{ stats.disabled || 0 }}</strong></div>
      <div class="stat"><span>已拒绝</span><strong>{{ stats.rejected || 0 }}</strong></div>
    </div>

    <div class="filters">
      <label>
        <span>状态</span>
        <select v-model="status" @change="load">
          <option value="">全部</option>
          <option value="pending">待审核</option>
          <option value="active">正常</option>
          <option value="disabled">已停用</option>
          <option value="rejected">已拒绝</option>
        </select>
      </label>
      <label class="search">
        <span>搜索</span>
        <input v-model.trim="search" placeholder="用户名或邮箱" @keyup.enter="load" />
      </label>
      <button type="button" class="ghost" :disabled="loading" @click="load">查询</button>
    </div>

    <p v-if="error" class="msg error">{{ error }}</p>
    <p v-if="notice" class="msg success">{{ notice }}</p>

    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>用户</th>
            <th>邮箱</th>
            <th>角色</th>
            <th>状态</th>
            <th>注册时间</th>
            <th>最近登录</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="!users.length">
            <td colspan="7" class="empty">{{ loading ? '加载中…' : '暂无用户' }}</td>
          </tr>
          <tr v-for="item in users" :key="item.id">
            <td>
              <strong>{{ item.display_name || item.username }}</strong>
              <small>@{{ item.username }}</small>
            </td>
            <td>{{ item.email || '—' }}</td>
            <td>
              <span class="tag" :class="item.role === 'admin' ? 'admin' : ''">
                {{ item.role === 'admin' ? '管理员' : '用户' }}
              </span>
            </td>
            <td>
              <span class="tag" :class="`status-${item.status}`">{{ statusLabel(item.status) }}</span>
            </td>
            <td>{{ formatTime(item.created_at) }}</td>
            <td>{{ formatTime(item.last_login_at) }}</td>
            <td class="row-actions">
              <button
                v-if="item.status === 'pending' || item.status === 'rejected'"
                type="button"
                class="ok"
                :disabled="busyId === item.id"
                @click="act(item, 'approve')"
              >
                通过
              </button>
              <button
                v-if="item.status === 'pending'"
                type="button"
                class="danger"
                :disabled="busyId === item.id"
                @click="act(item, 'reject')"
              >
                拒绝
              </button>
              <button
                v-if="item.status === 'disabled'"
                type="button"
                class="ok"
                :disabled="busyId === item.id"
                @click="act(item, 'enable')"
              >
                启用
              </button>
              <button
                v-if="item.status === 'active' && !item.isSelf"
                type="button"
                class="danger"
                :disabled="busyId === item.id"
                @click="act(item, 'disable')"
              >
                停用
              </button>
              <button
                v-if="item.status === 'active' && !item.isSelf"
                type="button"
                class="ghost"
                :disabled="busyId === item.id"
                @click="act(item, 'role')"
              >
                {{ item.role === 'admin' ? '设为用户' : '设为管理员' }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  approveUser,
  disableUser,
  enableUser,
  listUsers,
  rejectUser,
  setUserRole,
} from '@/api/authApi.js'
import { authErrorMessage } from '@/api/authHttp.js'
import { authState } from '@/modules/auth/authStore.js'

const router = useRouter()
const users = ref([])
const stats = ref({})
const status = ref('')
const search = ref('')
const loading = ref(false)
const busyId = ref(null)
const error = ref('')
const notice = ref('')

const statusLabels = {
  pending: '待审核',
  active: '正常',
  disabled: '已停用',
  rejected: '已拒绝',
}

function statusLabel(value) {
  return statusLabels[value] || value || '—'
}

function formatTime(value) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString()
}

function decorate(items) {
  const selfId = authState.user?.id
  return (Array.isArray(items) ? items : []).map((item) => ({
    ...item,
    isSelf: Number(item.id) === Number(selfId),
  }))
}

async function load() {
  loading.value = true
  error.value = ''
  notice.value = ''
  try {
    const data = await listUsers({
      status: status.value || undefined,
      search: search.value || undefined,
      limit: 300,
    })
    users.value = decorate(data.users)
    stats.value = data.stats || {}
  } catch (exc) {
    error.value = authErrorMessage(exc, '读取用户列表失败')
  } finally {
    loading.value = false
  }
}

async function act(item, action) {
  if (action === 'reject' && !window.confirm(`确定拒绝 ${item.username} 的注册申请吗？`)) return
  if (action === 'disable' && !window.confirm(`确定停用 ${item.username} 吗？`)) return
  busyId.value = item.id
  error.value = ''
  notice.value = ''
  try {
    if (action === 'approve') await approveUser(item.id)
    else if (action === 'reject') await rejectUser(item.id)
    else if (action === 'disable') await disableUser(item.id)
    else if (action === 'enable') await enableUser(item.id)
    else if (action === 'role') {
      await setUserRole(item.id, item.role === 'admin' ? 'user' : 'admin')
    }
    notice.value = '操作已完成。'
    await load()
  } catch (exc) {
    error.value = authErrorMessage(exc, '操作失败')
  } finally {
    busyId.value = null
  }
}

onMounted(load)
</script>

<style scoped>
.admin-page {
  min-height: 100vh;
  padding: 28px clamp(16px, 4vw, 48px) 48px;
  box-sizing: border-box;
  color: #e8fbff;
  background: radial-gradient(circle at 15% 0%, #0a3149 0%, #04101f 45%, #02080f 100%);
}

.admin-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 22px;
  flex-wrap: wrap;
}

.admin-head h1 {
  margin: 0;
  font-size: 26px;
  letter-spacing: 2px;
}

.admin-head p {
  margin: 6px 0 0;
  color: #8fb6c6;
  font-size: 14px;
}

.head-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 12px;
  margin-bottom: 18px;
}

.stat {
  padding: 14px 16px;
  border: 1px solid rgba(75, 213, 255, 0.2);
  border-radius: 12px;
  background: rgba(5, 26, 43, 0.8);
}

.stat span {
  display: block;
  color: #7fa7b8;
  font-size: 12px;
}

.stat strong {
  display: block;
  margin-top: 4px;
  font-size: 24px;
}

.stat.pending strong {
  color: #ffd479;
}

.filters {
  display: flex;
  align-items: flex-end;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 14px;
}

.filters label {
  display: flex;
  flex-direction: column;
  gap: 5px;
  color: #9fc2d2;
  font-size: 12px;
}

.filters .search input {
  width: min(280px, 60vw);
}

select,
input {
  height: 36px;
  padding: 0 10px;
  box-sizing: border-box;
  color: #eaf9ff;
  font-size: 14px;
  border: 1px solid rgba(75, 213, 255, 0.28);
  border-radius: 7px;
  background: rgba(2, 16, 28, 0.85);
  outline: none;
}

select:focus,
input:focus {
  border-color: rgba(82, 216, 250, 0.85);
}

.table-wrap {
  overflow: auto;
  border: 1px solid rgba(75, 213, 255, 0.18);
  border-radius: 12px;
  background: rgba(5, 26, 43, 0.72);
}

table {
  width: 100%;
  border-collapse: collapse;
  min-width: 900px;
}

th,
td {
  padding: 12px 14px;
  text-align: left;
  border-bottom: 1px solid rgba(75, 213, 255, 0.1);
  font-size: 13px;
  vertical-align: middle;
}

th {
  position: sticky;
  top: 0;
  color: #7fa7b8;
  font-weight: 600;
  background: rgba(4, 22, 37, 0.98);
}

td small {
  display: block;
  color: #6f93a3;
  font-size: 11px;
}

tr:last-child td {
  border-bottom: 0;
}

.empty {
  text-align: center;
  color: #7fa7b8;
  padding: 30px;
}

.tag {
  display: inline-block;
  padding: 2px 9px;
  border-radius: 10px;
  font-size: 12px;
  color: #9fc2d2;
  background: rgba(120, 160, 180, 0.16);
}

.tag.admin {
  color: #ffd479;
  background: rgba(255, 196, 64, 0.14);
}

.tag.status-active {
  color: #9ff5c4;
  background: rgba(50, 210, 130, 0.14);
}

.tag.status-pending {
  color: #ffd479;
  background: rgba(255, 196, 64, 0.14);
}

.tag.status-disabled,
.tag.status-rejected {
  color: #ffb0b0;
  background: rgba(255, 70, 70, 0.12);
}

.row-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

button {
  height: 32px;
  padding: 0 12px;
  border-radius: 7px;
  cursor: pointer;
  font-size: 13px;
}

button:disabled {
  opacity: 0.55;
  cursor: default;
}

.primary {
  border: 0;
  color: #041820;
  font-weight: 700;
  background: linear-gradient(135deg, #6fe6ff, #29c3f0);
}

.ghost {
  border: 1px solid rgba(75, 213, 255, 0.4);
  color: #bfe9f7;
  background: rgba(5, 33, 51, 0.7);
}

.ghost:hover:not(:disabled) {
  border-color: rgba(82, 216, 250, 0.85);
}

.ok {
  border: 0;
  color: #04210f;
  background: linear-gradient(135deg, #9ff5c4, #3bd68a);
}

.danger {
  border: 0;
  color: #2a0707;
  background: linear-gradient(135deg, #ffb0b0, #ff7676);
}

.msg {
  margin: 0 0 12px;
  padding: 9px 12px;
  font-size: 13px;
  border-radius: 8px;
}

.msg.error {
  color: #ffb0b0;
  background: rgba(255, 70, 70, 0.1);
}

.msg.success {
  color: #9ff5c4;
  background: rgba(50, 210, 130, 0.12);
}
</style>
