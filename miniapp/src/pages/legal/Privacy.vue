<template>
  <view class="legal">
    <view class="hd">
      <view class="hd-title">隐私政策</view>
      <view class="hd-sub">设巡通（设备资产巡检）</view>
      <view class="hd-sub">更新日期：2026年11月8日　生效日期：2026年11月8日</view>
    </view>

    <view class="body">
      <view v-for="(s, i) in sections" :key="i" class="sec">
        <view class="sec-title">{{ s.title }}</view>
        <view v-for="(p, j) in s.paras || []" :key="'p' + j" class="p">{{ p }}</view>
        <view v-for="(l, k) in s.items || []" :key="'i' + k" class="li">{{ l }}</view>
      </view>

      <view class="end">
        如对本政策有任何疑问、意见或投诉，请拨打 <text class="tel">13570383740</text>（工作日 9:00-17:30），我们会尽快处理。
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
interface Section {
  title: string
  paras?: string[]
  items?: string[]
}

const sections: Section[] = [
  {
    title: '一、我们是谁',
    paras: [
      '本政策适用于“设巡通（设备资产巡检）”微信小程序（以下称“本小程序”）。',
      '本小程序由广州白云国际机场股份有限公司 T3 航站楼 GTC 交通中心项目管理部（以下称“我们”）运营，是面向本单位内部授权人员的设备资产巡检工具，不向社会公众开放注册。',
    ],
  },
  {
    title: '二、我们收集哪些信息、用来做什么',
    paras: ['我们只收集实现下述功能所必需的信息，并逐项说明用途：'],
    items: [
      '1. 手机号：由你在登录页主动填写。用于核验你是否为已登记的内部授权人员，并作为巡检记录、盘点记录、工单的责任归属依据。不填写手机号将无法登录本系统。',
      '2. 位置信息：在你使用巡检打卡、设备位置标注、巡查线路节点定位时获取。用于记录巡检点位、判断是否在指定巡检范围内、在地图上标注设备所在位置。不触发上述功能时不获取。',
      '3. 摄像头：在你使用“扫码盘点”“扫码定位绑定”“扫描设备二维码”时调用。用于识别设备二维码与固定资产编号。不扫码时不调用。',
      '4. 蓝牙权限：在你使用蓝牙标签打印机打印设备二维码时请求。仅用于向现场打印机发送打印指令，不上传、不存储任何个人信息。',
      '5. 设备与日志信息：包括微信 openid、设备型号、操作系统版本、网络类型、操作与异常日志。用于保持登录状态、排查系统故障、保障账号与数据安全。',
    ],
  },
  {
    title: '三、我们如何收集',
    paras: [
      '我们仅在你主动操作时收集信息，例如点击“登录”“打卡”“扫码”，不会在后台静默收集。',
      '位置信息、摄像头、蓝牙需经你在微信授权弹窗中明确同意后才会被获取；若你拒绝授权，相关功能不可用，但设备与房间的查询浏览仍可正常使用。',
    ],
  },
  {
    title: '四、信息如何存储',
    items: [
      '1. 存储地点：中国境内本单位自有服务器，不传输至境外。',
      '2. 存储期限：账号信息在账号存续期间保存；你申请注销或离职后，我们在 30 日内删除或作匿名化处理，法律法规另有规定的除外。',
      '3. 巡检记录、位置记录、盘点记录按业务归档要求保存，最长不超过 3 年。',
    ],
  },
  {
    title: '五、我们是否对外提供',
    paras: ['我们不会向任何第三方出售、出租或共享你的个人信息。以下情形除外：'],
    items: [
      '1. 已取得你的明确同意；',
      '2. 法律法规规定，或司法、行政机关依法提出要求；',
      '3. 为保护你或其他人的生命、财产安全所必需。',
    ],
  },
  {
    title: '六、你的权利',
    items: [
      '1. 查询与更正：你可在“我的”页面查看姓名、部门与角色；信息有误可联系管理员或我们更正。',
      '2. 删除：你可要求删除与你相关的位置记录、巡检记录中的个人信息。',
      '3. 注销账号：你可申请注销账号，注销后该账号将无法再登录本系统。',
      '4. 撤回授权：你可在微信“设置 - 隐私”中关闭位置、相机授权；关闭后对应功能不可用，不影响其他查询功能。',
      '5. 行使方式：拨打 13570383740 提出申请，我们将在 15 个工作日内答复并处理。',
    ],
  },
  {
    title: '七、信息安全',
    paras: [
      '我们采用 HTTPS 加密传输、登录鉴权、按角色控制数据可见范围、关键操作留痕审计等措施保护你的信息。',
      '若发生个人信息泄露、损毁或丢失，我们将按法律法规要求及时告知你，并向有关主管部门报告。',
    ],
  },
  {
    title: '八、未成年人',
    paras: [
      '本小程序为内部工作工具，不面向未成年人提供服务。若发现误收集了未成年人信息，我们会尽快删除。',
    ],
  },
  {
    title: '九、本政策的更新',
    paras: [
      '本政策变更时，我们会在小程序内以弹窗或页面公告的方式通知你；涉及收集范围、使用目的等重大变更的，会重新征得你的同意。',
    ],
  },
  {
    title: '十、联系我们',
    paras: ['联系电话：13570383740（工作日 9:00-17:30）。'],
  },
]
</script>

<style scoped lang="scss">
.legal {
  min-height: 100vh;
  background: $tm-bg;
  padding: 24rpx 24rpx calc(env(safe-area-inset-bottom) + 40rpx);
}
.hd {
  padding: 8rpx 8rpx 24rpx;
}
.hd-title {
  font-size: 40rpx;
  font-weight: 700;
  color: $tm-text;
}
.hd-sub {
  margin-top: 8rpx;
  font-size: 24rpx;
  color: $tm-text-muted;
  line-height: 1.6;
}
.body {
  background: $tm-card-bg;
  border-radius: $tm-radius;
  padding: 32rpx 28rpx;
  box-shadow: $tm-shadow-card;
}
.sec {
  margin-bottom: 32rpx;
}
.sec:last-of-type {
  margin-bottom: 8rpx;
}
.sec-title {
  font-size: 30rpx;
  font-weight: 700;
  color: $tm-text;
  margin-bottom: 12rpx;
}
.p {
  font-size: 27rpx;
  line-height: 1.8;
  color: $tm-text-secondary;
  margin-bottom: 10rpx;
}
.li {
  font-size: 27rpx;
  line-height: 1.8;
  color: $tm-text-secondary;
  margin-bottom: 10rpx;
  padding-left: 8rpx;
}
.end {
  margin-top: 16rpx;
  padding-top: 24rpx;
  border-top: 1rpx solid $tm-border-light;
  font-size: 26rpx;
  line-height: 1.8;
  color: $tm-text-muted;
}
.tel {
  color: $tm-primary;
  font-weight: 600;
}
</style>
