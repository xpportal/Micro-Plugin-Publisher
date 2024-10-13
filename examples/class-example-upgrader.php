<?php
/**
 * Custom Plugin Updater for XR Publisher
 *
 * BRUTE FOCED WORK IN PROGRESS
 * This is a brute force example of how to implement a custom plugin updater for XR Publisher.
 * @package xrPublisher
 */

namespace xrPublisher;

if (!defined('ABSPATH')) {
    exit; // Exit if accessed directly
}

class XR_Publisher_Updater {
    private $plugin_slug;
    private $plugin_name;
    private $version;
    private $metadata_url;
    private $zip_url;

    public function __construct($plugin_slug, $plugin_name, $version, $metadata_url, $zip_url) {
        $this->plugin_slug = $plugin_slug;
        $this->plugin_name = $plugin_name;
        $this->version = $version;
        $this->metadata_url = $metadata_url;
        $this->zip_url = $zip_url;

        add_filter('pre_set_site_transient_update_plugins', array($this, 'check_for_update'));
        add_filter('plugins_api', array($this, 'plugin_info'), 20, 3);
    }

    public function check_for_update($transient) {
        if (empty($transient->checked)) {
            return $transient;
        }

        $remote_info = $this->get_remote_info();

        if (is_wp_error($remote_info)) {
            return $transient;
        }

        if (version_compare($this->version, $remote_info->version, '<')) {
            $obj = new \stdClass();
            $obj->slug = $this->plugin_slug;
            $obj->new_version = $remote_info->version;
            $obj->url = $remote_info->homepage;
            $obj->package = $this->zip_url;
            $obj->plugin = $this->plugin_name;
            $transient->response[$this->plugin_name] = $obj;
        } else {
            $obj = new \stdClass();
            $obj->slug = $this->plugin_slug;
            $obj->plugin = $this->plugin_name;
            $obj->new_version = $this->version;
            $obj->url = $remote_info->homepage;
            $obj->package = '';
            $transient->no_update[$this->plugin_name] = $obj;
        }

        return $transient;
    }

    public function plugin_info($false, $action, $response) {
        if ($action !== 'plugin_information') {
            return $false;
        }

        if ($response->slug !== $this->plugin_slug) {
            return $false;
        }

        $remote_info = $this->get_remote_info();

        if (is_wp_error($remote_info)) {
            return $false;
        }

        $response = new \stdClass();
        $response->name = $remote_info->name;
        $response->slug = $this->plugin_slug;
        $response->version = $remote_info->version;
        $response->author = $remote_info->author;
        $response->homepage = $remote_info->homepage;
        $response->requires = $remote_info->requires;
        $response->tested = $remote_info->tested;
        $response->downloaded = $remote_info->downloaded;
        $response->last_updated = $remote_info->last_updated;
        $response->sections = array(
            'description' => $remote_info->description,
            'installation' => $remote_info->installation ?? '',
            'changelog' => $remote_info->changelog ?? '',
        );
        $response->download_link = $this->zip_url;

        return $response;
    }

    private function get_remote_info() {
        $request = wp_remote_get($this->metadata_url);

        if (is_wp_error($request)) {
            return $request;
        }

        $body = wp_remote_retrieve_body($request);
        $data = json_decode($body);

        if (empty($data) || !is_object($data)) {
            return new \WP_Error('invalid_response', 'Invalid update server response.');
        }

        return $data;
    }
}