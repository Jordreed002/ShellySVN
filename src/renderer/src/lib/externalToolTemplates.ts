/**
 * External diff/merge tool argument templates (#87).
 *
 * The pure placeholder/expansion logic now lives in the shared package
 * (`@shared/external-tool-templates`) so the settings-UI live preview here
 * and the main-process launcher (services/external-template-launcher) use
 * the exact same code and can never diverge. This module remains as the
 * renderer-side import point.
 */

export * from '@shared/external-tool-templates';
