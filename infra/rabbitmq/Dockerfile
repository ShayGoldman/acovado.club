FROM rabbitmq:management

# Install curl for downloading the plugin
USER root
RUN apt-get update && \
    apt-get install -y curl && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Download and enable delayed message exchange plugin
USER rabbitmq
RUN PLUGIN_VERSION="3.13.0" && \
    curl -L -o /opt/rabbitmq/plugins/rabbitmq_delayed_message_exchange-${PLUGIN_VERSION}.ez \
      https://github.com/rabbitmq/rabbitmq-delayed-message-exchange/releases/download/v${PLUGIN_VERSION}/rabbitmq_delayed_message_exchange-${PLUGIN_VERSION}.ez && \
    rabbitmq-plugins enable --offline rabbitmq_delayed_message_exchange

