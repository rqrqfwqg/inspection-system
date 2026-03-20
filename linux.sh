#!/bin/bash
# sudo curl -o linux.sh https://go2tencentcloud-1251783334.cos.accelerate.myqcloud.com/lighthouse/linux.sh && sudo chmod +x linux.sh && sudo ./linux.sh
secretId=$1
secretKey=$2
sessionToken=$3
before() {
ps -ef | grep go2tencentcloud | grep -v grep | cut -c 9-15 | xargs kill -s 9
}

download_tool(){
  timeout 420 curl -o go2tencentcloud.tar.gz https://go2tencentcloud-1251783334.cos.accelerate.myqcloud.com/latest/go2tencentcloud.tar.gz
  if [ "$?" != "0" ]; then
    curl -o go2tencentcloud.tar.gz https://go2tencentcloud-1251783334.cos.accelerate.myqcloud.com/latest/go2tencentcloud.tar.gz
  fi
}

run(){
tar -zxvf go2tencentcloud.tar.gz
cd ./go2tencentcloud/go2tencentcloud-linux  || exit
if [ -n "$sessionToken" ]; then
  param="-lighthouse --secret-id=${secretId} --secret-key=${secretKey} --session-token=${sessionToken}"
else
  param="-lighthouse --secret-id=${secretId} --secret-key=${secretKey}"
fi
arch=$(arch)
if [ $arch = "x86_64" ]; then
  chmod +x ./go2tencentcloud_x64
  ./go2tencentcloud_x64 $param
elif [ $arch = "x86_32" ] || [ $arch = "i686" ]; then
  chmod +x ./go2tencentcloud_x32
  ./go2tencentcloud_x32 $param
elif [ $arch = "aarch64" ]; then
  chmod +x ./go2tencentcloud_arm64
  ./go2tencentcloud_arm64 $param
else
  echo "$arch" "not supported"
fi
}

main(){
before
download_tool || exit 2
run || exit 3
}
main