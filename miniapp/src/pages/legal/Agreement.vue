<template>
  <view class="legal">
    <view class="hd">
      <view class="hd-title">用户服务协议</view>
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
        你在登录页勾选同意并完成登录，即表示你已阅读、理解并接受本协议全部内容。如有疑问请拨打
        <text class="tel">13570383740</text>。
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
    title: '一、协议适用范围',
    paras: [
      '本协议是你与广州白云国际机场股份有限公司 T3 航站楼 GTC 交通中心项目管理部（以下称“我们”）之间，就使用“设巡通（设备资产巡检）”微信小程序（以下称“本小程序”）达成的约定。',
      '本小程序为本单位内部工作工具，仅向已完成信息登记并获得授权的内部人员开放，不面向社会公众注册使用。',
    ],
  },
  {
    title: '二、账号使用',
    items: [
      '1. 你应使用本人已登记的手机号登录，不得借用他人身份或代他人登录。',
      '2. 账号仅限本人使用，不得转借、出租、出售或以任何方式提供给第三方。',
      '3. 你应妥善保管登录设备与微信账号，因你自身原因导致账号被他人使用所产生的后果由你承担。',
      '4. 人员岗位或授权范围发生变化时，我们有权调整或收回相应权限。',
    ],
  },
  {
    title: '三、数据保密',
    items: [
      '1. 你在使用过程中接触到的设备台账、机房信息、巡检记录、工单等数据，均属本单位内部管理信息，你负有保密义务。',
      '2. 不得以截图、拍照、导出、转发等任何方式向无关人员或外部单位提供上述数据。',
      '3. 因工作需要对外提供数据，须经本单位相关负责人书面批准。',
    ],
  },
  {
    title: '四、使用规范',
    items: [
      '1. 不得利用本小程序从事与本职工作无关的活动。',
      '2. 不得批量抓取、爬取、导出系统数据，不得对系统进行反向工程、注入攻击或其他破坏性操作。',
      '3. 应如实填写巡检、盘点、设备新增等业务记录，不得伪造、篡改数据。',
      '4. 发现数据错误或系统异常，应及时反馈，不得擅自修改后台数据。',
    ],
  },
  {
    title: '五、个人信息保护',
    paras: [
      '我们收集和处理你个人信息的方式、范围与目的，详见《隐私政策》。该政策与本协议具有同等效力。',
    ],
  },
  {
    title: '六、服务变更与中断',
    paras: [
      '因系统升级、设备维护、网络故障或不可抗力导致服务临时中断的，我们会尽快恢复，不因此承担赔偿责任。我们有权根据业务需要调整功能，调整前会在小程序内公告。',
    ],
  },
  {
    title: '七、违约处理',
    paras: [
      '你违反本协议约定，我们有权视情节采取提醒、限制功能、暂停账号、收回权限等措施；造成数据泄露或其他损失的，依法追究相应责任。',
    ],
  },
  {
    title: '八、协议更新',
    paras: [
      '本协议更新时，我们会在小程序内以公告或弹窗方式通知你。更新后你继续使用本小程序，即视为接受更新后的协议。',
    ],
  },
  {
    title: '九、联系我们',
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
