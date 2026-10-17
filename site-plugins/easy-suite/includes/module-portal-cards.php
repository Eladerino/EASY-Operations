<?php
/**
 * Module: Portal card layout.
 *
 * The instructor and student portal pages render their navigation as a
 * <ul class="ins-portal-list"> card list. The theme's two-column card
 * layout overflows on phone screens (cards overlap each other), so on
 * narrow viewports the cards stack in a single column with a readable
 * heading size. Output is scoped to the two portal hub pages; the
 * coming-soon views are the same pages with a query arg, so they are
 * covered too.
 */

defined('ABSPATH') || exit;

add_action('wp_head', function () {
    if (!is_page(['instructor-portal', 'student-portal'])) {
        return;
    }
    ?>
<style id="easy-suite-portal-cards">
@media only screen and (max-width: 768px) {
	ul.ins-portal-list{display:block !important;margin:0 !important;padding:0 !important;list-style:none !important;}
	ul.ins-portal-list > li{display:block !important;width:100% !important;max-width:100% !important;float:none !important;clear:both !important;margin:0 0 36px !important;box-sizing:border-box !important;}
	ul.ins-portal-list > li:last-child{margin-bottom:0 !important;}
	ul.ins-portal-list > li h2{font-size:30px !important;line-height:1.25 !important;white-space:normal !important;overflow-wrap:break-word !important;}
	ul.ins-portal-list > li h2 a{white-space:normal !important;}
}
</style>
    <?php
});
