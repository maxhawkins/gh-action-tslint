FROM node:lts-alpine
MAINTAINER Amir Omidi "amir@aaomidi.com"

WORKDIR /var/task

COPY run.sh package.json yarn.lock tsconfig.json src ./

RUN yarn install
RUN yarn build

COPY dist/index.js .

ENTRYPOINT ["run.sh"]